import type { RealtimeChannel } from '@supabase/supabase-js';
import { DEMO, local } from '../config';
import type { Snapshot } from '../engine';
import {
  TABLES, dbTable, type AuditEntry, type Member, type Payer, type Project, type TableName, type Tables,
} from '../types';
import { idb, type OutboxOp } from './idb';
import { sb } from './supabase';

type Data = { [K in TableName]: Map<string, Tables[K]> };
type AnyRow = Tables[TableName];
type Patch<K extends TableName> = Partial<Tables[K]> & { id?: string };

export interface Conflict {
  table: TableName;
  rowId: string;
  mine: Record<string, unknown>;
  theirs: Record<string, unknown>;
}

export type StoreState = 'loading' | 'ready' | 'not_member' | 'error';

const AFTER_INFLIGHT = '__after_inflight__';
const SERVER_FIELDS = ['created_at', 'created_by', 'updated_at', 'updated_by'];
const key = (t: string, id: string) => `${t}:${id}`;
export const uuid = () => crypto.randomUUID();

function emptyData(): Data {
  const d = {} as Record<TableName, Map<string, AnyRow>>;
  for (const t of TABLES) d[t] = new Map();
  return d as Data;
}

function isNetworkError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e);
  return e instanceof TypeError || /fetch|network|Failed to fetch|Load failed/i.test(msg);
}

class Store {
  data: Data = emptyData();
  members: Member[] = [];
  audit: AuditEntry[] = [];
  projectId: string | null = null;
  userId = '';
  email = '';
  state: StoreState = 'loading';
  online = navigator.onLine;
  syncing = false;
  conflicts: Conflict[] = [];
  syncErrors: string[] = [];

  private serverVersion = new Map<string, string | null>();
  private outbox: (OutboxOp & { inFlight?: boolean })[] = [];
  private listeners = new Set<() => void>();
  private emitQueued = false;
  private persistTimer: number | undefined;
  private channel: RealtimeChannel | null = null;
  private flushHooks: (() => Promise<void>)[] = [];

  // ---------- subscription ----------
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.listeners.forEach((fn) => fn());
    });
  }
  onFlush(fn: () => Promise<void>) { this.flushHooks.push(fn); }

  get pendingCount() { return this.outbox.length; }

  // ---------- lifecycle ----------
  async init(userId: string, email: string) {
    this.userId = userId;
    this.email = email;
    await this.loadCache();
    window.addEventListener('online', () => { this.online = true; this.emit(); void this.refresh().then(() => this.flush()); });
    window.addEventListener('offline', () => { this.online = false; this.emit(); });

    if (DEMO) {
      if (!this.projectId) this.seedDemo();
      this.state = 'ready';
      this.emit();
      return;
    }
    if (!this.online) {
      this.state = this.projectId ? 'ready' : 'error';
      this.emit();
      return;
    }
    try {
      await this.refresh();
      this.state = this.projectId ? 'ready' : 'not_member';
      if (this.projectId) {
        this.subscribeRealtime();
        void this.flush();
      }
    } catch (e) {
      console.error(e);
      this.state = this.projectId ? 'ready' : 'error';
    }
    this.emit();
  }

  private async loadCache() {
    const db = await idb();
    for (const t of TABLES) {
      const rows = ((await db.get('cache', t)) ?? []) as AnyRow[];
      const m = this.data[t] as Map<string, AnyRow>;
      rows.forEach((r) => m.set(r.id, r));
    }
    this.members = (await db.get('cache', 'members')) ?? [];
    this.audit = (await db.get('cache', 'audit')) ?? [];
    this.projectId = (await db.get('kv', 'projectId')) ?? null;
    const sv: [string, string | null][] = (await db.get('kv', 'serverVersion')) ?? [];
    this.serverVersion = new Map(sv);
    this.outbox = await db.getAll('outbox');
  }

  private schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => void this.persist(), 400);
  }

  private async persist() {
    const db = await idb();
    const tx = db.transaction(['cache', 'kv'], 'readwrite');
    for (const t of TABLES) await tx.objectStore('cache').put([...this.data[t].values()], t);
    await tx.objectStore('cache').put(this.members, 'members');
    await tx.objectStore('cache').put(this.audit.slice(0, 500), 'audit');
    await tx.objectStore('kv').put(this.projectId, 'projectId');
    await tx.objectStore('kv').put([...this.serverVersion.entries()], 'serverVersion');
    await tx.done;
  }

  /** Full reload from Supabase (data volumes are small). Local pending edits stay on top. */
  async refresh() {
    if (DEMO || !this.online) return;
    const client = sb();
    const { data: mem, error: memErr } = await client.from('hb_project_members').select('*').eq('user_id', this.userId);
    if (memErr) throw memErr;
    if (!mem || mem.length === 0) { this.projectId = null; return; }
    this.projectId = mem[0].project_id as string;

    const { data: allMembers } = await client.from('hb_project_members').select('*').eq('project_id', this.projectId);
    this.members = (allMembers ?? []) as Member[];

    const pending = new Set(this.outbox.map((o) => key(o.table, o.rowId)));
    for (const t of TABLES) {
      const rows: AnyRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client.from(dbTable(t)).select('*').eq('project_id', this.projectId).range(from, from + 999);
        if (error) throw error;
        rows.push(...(data as AnyRow[]));
        if (!data || data.length < 1000) break;
      }
      const m = this.data[t] as Map<string, AnyRow>;
      const fresh = new Map<string, AnyRow>();
      for (const r of rows) {
        this.serverVersion.set(key(t, r.id), r.updated_at ?? null);
        fresh.set(r.id, pending.has(key(t, r.id)) ? (m.get(r.id) ?? r) : r);
      }
      for (const [id, r] of m) if (pending.has(key(t, id)) && !fresh.has(id)) fresh.set(id, r);
      (this.data as Record<TableName, Map<string, AnyRow>>)[t] = fresh;
    }
    const { data: audit } = await client.from('hb_audit_log').select('*')
      .eq('project_id', this.projectId).order('at', { ascending: false }).limit(300);
    this.audit = (audit ?? []) as AuditEntry[];
    this.schedulePersist();
    this.emit();
  }

  private subscribeRealtime() {
    if (DEMO || this.channel) return;
    const client = sb();
    const ch = client.channel(`hb-${this.projectId}`);
    for (const t of TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: dbTable(t), filter: `project_id=eq.${this.projectId}` },
        (payload) => this.applyRemote(t, payload.eventType, (payload.new ?? payload.old) as AnyRow));
    }
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hb_audit_log', filter: `project_id=eq.${this.projectId}` },
      (payload) => {
        const e = payload.new as AuditEntry;
        if (!this.audit.some((a) => a.id === e.id)) this.audit.unshift(e);
        this.schedulePersist();
        this.emit();
      });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') void this.refresh();
    });
    this.channel = ch;
  }

  private applyRemote(t: TableName, event: string, row: AnyRow) {
    if (!row?.id) return;
    const k = key(t, row.id);
    const m = this.data[t] as Map<string, AnyRow>;
    if (event === 'DELETE') {
      m.delete(row.id);
      this.serverVersion.delete(k);
    } else {
      this.serverVersion.set(k, row.updated_at ?? null);
      const hasPending = this.outbox.some((o) => o.table === t && o.rowId === row.id);
      if (!hasPending) m.set(row.id, row);
    }
    this.schedulePersist();
    this.emit();
  }

  // ---------- reads ----------
  all<K extends TableName>(t: K, opts: { includeDeleted?: boolean } = {}): Tables[K][] {
    const rows = [...this.data[t].values()] as Tables[K][];
    return opts.includeDeleted ? rows : rows.filter((r) => !r.deleted_at);
  }
  get<K extends TableName>(t: K, id: string | null | undefined): Tables[K] | undefined {
    return id ? (this.data[t].get(id) as Tables[K] | undefined) : undefined;
  }
  project(): Project | undefined {
    return this.projectId ? this.get('projects', this.projectId) : undefined;
  }
  snapshot(): Snapshot {
    return {
      commitments: this.all('commitments'),
      milestones: this.all('milestones'),
      variations: this.all('variations'),
      payments: this.all('payments'),
      links: this.all('document_links'),
      contingencyPct: Number(this.project()?.contingency_pct ?? 10),
    };
  }
  memberName(userId: string | null | undefined): string {
    if (!userId) return 'النظام';
    return this.members.find((m) => m.user_id === userId)?.display_name ?? 'مستخدم';
  }
  myName(): string { return this.memberName(this.userId); }
  payers(): Payer[] { return this.all('payers').sort((a, b) => a.name.localeCompare(b.name, 'ar')); }
  defaultPayerId(): string | undefined {
    const last = local.get(`lastPayer.${this.userId}`);
    if (last && this.get('payers', last) && !this.get('payers', last)!.deleted_at) return last;
    return this.payers().find((p) => p.user_id === this.userId)?.id ?? this.payers()[0]?.id;
  }
  rememberPayer(id: string) { local.set(`lastPayer.${this.userId}`, id); }
  linksTo(entityType: string, entityId: string) {
    return this.all('document_links').filter((l) => l.entity_type === entityType && l.entity_id === entityId);
  }
  docsFor(entityType: string, entityId: string) {
    return this.linksTo(entityType, entityId)
      .map((l) => this.get('documents', l.document_id))
      .filter((d): d is Tables['documents'] => !!d && !d.deleted_at);
  }

  // ---------- writes ----------
  save<K extends TableName>(t: K, patch: Patch<K>, opts: { audit?: boolean } = {}): Tables[K] {
    if (!this.projectId) throw new Error('No project');
    const now = new Date().toISOString();
    const id = patch.id ?? uuid();
    const existing = this.data[t].get(id) as Tables[K] | undefined;
    const row = Object.assign(
      { deleted_at: null },
      existing ?? { created_at: now, created_by: this.userId },
      patch,
      { id, project_id: t === 'projects' ? id : this.projectId, updated_at: now, updated_by: this.userId },
    ) as Tables[K];
    (this.data[t] as Map<string, Tables[K]>).set(id, row);

    if (DEMO) {
      if (opts.audit !== false) this.localAudit(t, existing ?? null, row);
    } else {
      void this.enqueue(t, id, existing ? 'update' : 'insert', row as unknown as Record<string, unknown>);
    }
    this.schedulePersist();
    this.emit();
    return row;
  }

  softDelete(t: TableName, id: string) {
    const ts = new Date().toISOString();
    const mark = (tt: TableName, rid: string) => {
      const r = this.get(tt, rid);
      if (r && !r.deleted_at) this.save(tt, { id: rid, deleted_at: ts } as Patch<typeof tt>);
    };
    for (const [tt, rid] of this.cascade(t, id)) mark(tt, rid);
    mark(t, id);
    return ts;
  }

  restore(t: TableName, id: string) {
    const r = this.get(t, id);
    if (!r?.deleted_at) return;
    const ts = r.deleted_at;
    this.save(t, { id, deleted_at: null } as Patch<typeof t>);
    for (const [tt, rid] of this.cascade(t, id, true)) {
      const c = this.get(tt, rid);
      if (c?.deleted_at === ts) this.save(tt, { id: rid, deleted_at: null } as Patch<typeof tt>);
    }
  }

  /** Children that follow a parent into (and out of) the trash. */
  private cascade(t: TableName, id: string, includeDeleted = false): [TableName, string][] {
    const o = { includeDeleted };
    const out: [TableName, string][] = [];
    const links = (type: string, eid: string) =>
      this.all('document_links', o).filter((l) => l.entity_type === type && l.entity_id === eid).forEach((l) => out.push(['document_links', l.id]));
    if (t === 'vendors') {
      links('vendor', id);
      this.all('commitments', o).filter((c) => c.vendor_id === id).forEach((c) => {
        out.push(...this.cascade('commitments', c.id, includeDeleted));
        out.push(['commitments', c.id]);
      });
    } else if (t === 'commitments') {
      links('commitment', id);
      this.all('payments', o).filter((p) => p.commitment_id === id).forEach((p) => { links('payment', p.id); out.push(['payments', p.id]); });
      this.all('milestones', o).filter((m) => m.commitment_id === id).forEach((m) => { links('milestone', m.id); out.push(['milestones', m.id]); });
      this.all('variations', o).filter((v) => v.commitment_id === id).forEach((v) => { links('variation', v.id); out.push(['variations', v.id]); });
    } else if (t === 'payments') links('payment', id);
    else if (t === 'milestones') links('milestone', id);
    else if (t === 'variations') links('variation', id);
    else if (t === 'documents') {
      this.all('document_links', o).filter((l) => l.document_id === id).forEach((l) => out.push(['document_links', l.id]));
    }
    return out;
  }

  /** Put a record back to the field values it had in an audit entry. */
  restoreValues(t: TableName, id: string, values: Record<string, unknown>) {
    const clean: Record<string, unknown> = { ...values };
    for (const f of [...SERVER_FIELDS, 'project_id', 'id']) delete clean[f];
    this.save(t, { ...clean, id } as Patch<typeof t>);
  }

  // ---------- outbox ----------
  private async enqueue(t: TableName, rowId: string, kind: 'insert' | 'update', row: Record<string, unknown>) {
    const db = await idb();
    const existing = this.outbox.find((o) => o.table === t && o.rowId === rowId && !o.inFlight);
    if (existing) {
      existing.row = row;
      await db.put('outbox', stripInFlight(existing));
    } else {
      const inFlight = this.outbox.some((o) => o.table === t && o.rowId === rowId && o.inFlight);
      const op: OutboxOp = {
        table: t, rowId, kind: inFlight ? 'update' : kind, row,
        baseUpdatedAt: inFlight ? AFTER_INFLIGHT : (this.serverVersion.get(key(t, rowId)) ?? null),
        tries: 0,
      };
      op.seq = (await db.add('outbox', op)) as number;
      this.outbox.push(op);
    }
    this.emit();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (DEMO || this.syncing || !this.online || !this.projectId) return;
    this.syncing = true;
    this.emit();
    const db = await idb();
    try {
      while (this.outbox.length) {
        const op = this.outbox[0];
        op.inFlight = true;
        let result: 'done' | 'retry-later' | 'drop' = 'done';
        try {
          result = await this.send(op);
        } catch (e) {
          if (isNetworkError(e)) result = 'retry-later';
          else {
            op.tries++;
            console.error('sync error', e);
            if (op.tries >= 3) {
              this.syncErrors.unshift(`${op.table}: ${(e as Error).message ?? e}`);
              result = 'drop';
            } else result = 'retry-later';
          }
        }
        op.inFlight = false;
        if (result === 'retry-later') { await db.put('outbox', stripInFlight(op)); break; }
        this.outbox.shift();
        await db.delete('outbox', op.seq!);
      }
      for (const hook of this.flushHooks) await hook();
    } finally {
      this.syncing = false;
      this.schedulePersist();
      this.emit();
    }
  }

  private async send(op: OutboxOp): Promise<'done' | 'drop'> {
    const client = sb();
    const table = dbTable(op.table);
    const payload = { ...op.row };
    for (const f of SERVER_FIELDS) delete payload[f];
    const k = key(op.table, op.rowId);

    const accept = (row: AnyRow) => {
      this.serverVersion.set(k, row.updated_at ?? null);
      const later = this.outbox.find((o) => o !== op && o.table === op.table && o.rowId === op.rowId);
      if (later) {
        if (later.baseUpdatedAt === AFTER_INFLIGHT) later.baseUpdatedAt = row.updated_at ?? null;
      } else {
        (this.data[op.table as TableName] as Map<string, AnyRow>).set(row.id, row);
      }
    };

    if (op.kind === 'insert') {
      const { data, error } = await client.from(table).insert(payload).select().single();
      if (error?.code === '23505') { op.kind = 'update'; op.baseUpdatedAt = null; return this.send(op); }
      if (error) throw error;
      accept(data as AnyRow);
      return 'done';
    }

    let q = client.from(table).update(payload).eq('id', op.rowId);
    if (op.baseUpdatedAt && op.baseUpdatedAt !== AFTER_INFLIGHT) q = q.eq('updated_at', op.baseUpdatedAt);
    const { data, error } = await q.select();
    if (error) throw error;
    if (data && data.length) { accept(data[0] as AnyRow); return 'done'; }

    const { data: current, error: curErr } = await client.from(table).select('*').eq('id', op.rowId).maybeSingle();
    if (curErr) throw curErr;
    if (!current) {
      const { data: ins, error: insErr } = await client.from(table).insert(payload).select().single();
      if (insErr) throw insErr;
      accept(ins as AnyRow);
      return 'done';
    }
    // Someone else changed this row since we read it.
    this.conflicts.push({ table: op.table as TableName, rowId: op.rowId, mine: op.row, theirs: current });
    this.serverVersion.set(k, current.updated_at);
    (this.data[op.table as TableName] as Map<string, AnyRow>).set(op.rowId, current as AnyRow);
    return 'drop';
  }

  resolveConflict(c: Conflict, keep: 'mine' | 'theirs') {
    this.conflicts = this.conflicts.filter((x) => x !== c);
    if (keep === 'mine') this.restoreValues(c.table, c.rowId, c.mine);
    this.emit();
  }

  // ---------- audit ----------
  async history(t: TableName, id: string): Promise<AuditEntry[]> {
    if (DEMO || !this.online) {
      return this.audit.filter((a) => a.entity_type === dbTable(t) && a.entity_id === id);
    }
    const { data, error } = await sb().from('hb_audit_log').select('*')
      .eq('entity_type', dbTable(t)).eq('entity_id', id).order('at', { ascending: false }).limit(100);
    if (error) throw error;
    return (data ?? []) as AuditEntry[];
  }

  private localAudit(t: TableName, before: AnyRow | null, after: AnyRow) {
    let action: AuditEntry['action'] = before ? 'update' : 'insert';
    if (before && !before.deleted_at && after.deleted_at) action = 'delete';
    if (before?.deleted_at && !after.deleted_at) action = 'restore';
    this.audit.unshift({
      id: uuid(), project_id: this.projectId!, entity_type: dbTable(t), entity_id: after.id, action,
      before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown>,
      user_id: this.userId, at: new Date().toISOString(),
    });
  }

  // ---------- demo ----------
  private seedDemo() {
    const pid = uuid();
    this.projectId = pid;
    this.members = [
      { project_id: pid, user_id: this.userId, display_name: 'أحمد' },
      { project_id: pid, user_id: 'demo-father', display_name: 'الوالد' },
    ];
    this.save('projects', { id: pid, name: 'بيتي', plot_no: null, location: null, contingency_pct: 10 }, { audit: false });
    this.save('payers', { name: 'أحمد', user_id: this.userId }, { audit: false });
    this.save('payers', { name: 'الوالد', user_id: 'demo-father' }, { audit: false });
  }

  async updateDisplayName(name: string) {
    const me = this.members.find((m) => m.user_id === this.userId);
    if (me) me.display_name = name;
    if (!DEMO) await sb().from('hb_project_members').update({ display_name: name }).eq('user_id', this.userId).eq('project_id', this.projectId!);
    this.schedulePersist();
    this.emit();
  }

  async resetLocal() {
    const db = await idb();
    await Promise.all(['cache', 'outbox', 'uploads', 'blobs', 'kv'].map((s) => db.clear(s)));
  }
}

function stripInFlight(op: OutboxOp & { inFlight?: boolean }): OutboxOp {
  const { inFlight: _ignored, ...rest } = op;
  return rest;
}

export const store = new Store();
