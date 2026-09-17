// Pure financial engine. All amounts are integer fils. UI never computes money itself.
import type {
  Category, Commitment, CommitmentStatus, DocLink, Milestone, MilestoneStatus, Payment, Variation,
} from './types';
import { daysBetween } from './dates';

export interface Snapshot {
  commitments: Commitment[];
  milestones: Milestone[];
  variations: Variation[];
  payments: Payment[];
  links: DocLink[];
  contingencyPct: number;
}

export interface CommitmentFigures {
  original: number;
  variationsTotal: number;
  adjusted: number;
  paid: number;
  remaining: number;
  retentionHeld: number;
  status: CommitmentStatus;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function approvedVariationsTotal(commitmentId: string, variations: Variation[]): number {
  return sum(variations.filter((v) => v.commitment_id === commitmentId && v.status === 'approved').map((v) => v.amount));
}

export function paymentsFor(commitmentId: string, payments: Payment[]): Payment[] {
  return payments.filter((p) => p.commitment_id === commitmentId);
}

export function commitmentFigures(c: Commitment, s: Pick<Snapshot, 'variations' | 'payments'>): CommitmentFigures {
  const variationsTotal = approvedVariationsTotal(c.id, s.variations);
  const adjusted = c.original_amount + variationsTotal;
  const ps = paymentsFor(c.id, s.payments);
  const paid = sum(ps.map((p) => p.amount));
  const released = sum(ps.filter((p) => p.kind === 'retention_release').map((p) => p.amount));
  const retentionHeld = Math.max(0, sum(ps.map((p) => p.retention_held)) - released);
  let status: CommitmentStatus = c.status;
  if (c.status === 'approved' && adjusted > 0 && paid >= adjusted) status = 'fully_paid';
  return { original: c.original_amount, variationsTotal, adjusted, paid, remaining: adjusted - paid, retentionHeld, status };
}

export function milestoneStatus(m: Milestone, payments: Payment[], todayYmd: string): MilestoneStatus {
  const paid = sum(payments.filter((p) => p.milestone_id === m.id).map((p) => p.amount));
  if (m.amount > 0 && paid >= m.amount) return 'paid';
  if (paid > 0) return 'partially_paid';
  if (m.marked_due) return 'due';
  if (m.due_date && m.due_date <= todayYmd) return 'due';
  return 'not_due';
}

export function milestonePaid(m: Milestone, payments: Payment[]): number {
  return sum(payments.filter((p) => p.milestone_id === m.id).map((p) => p.amount));
}

/** Difference between the milestone schedule and the adjusted value (0 = balanced). */
export function scheduleGap(c: Commitment, s: Pick<Snapshot, 'milestones' | 'variations' | 'payments'>): number {
  const ms = s.milestones.filter((m) => m.commitment_id === c.id);
  if (ms.length === 0) return 0;
  return commitmentFigures(c, s).adjusted - sum(ms.map((m) => m.amount));
}

export interface ProjectFigures {
  committed: number;      // Σ adjusted (non-cancelled) + paid on cancelled
  paid: number;
  remaining: number;      // Σ positive remaining on non-cancelled
  contingency: number;
  forecast: number;
  progress: number;       // paid / forecast
  estimatesTotal: number; // part of committed that is still an estimate
}

export function projectFigures(s: Snapshot): ProjectFigures {
  let committed = 0, paid = 0, remaining = 0, estimatesTotal = 0;
  for (const c of s.commitments) {
    const f = commitmentFigures(c, s);
    paid += f.paid;
    if (c.status === 'cancelled') { committed += f.paid; continue; }
    committed += Math.max(f.adjusted, f.paid);
    remaining += Math.max(0, f.remaining);
    if (c.status === 'estimated') estimatesTotal += f.adjusted;
  }
  const contingency = Math.round((remaining * s.contingencyPct) / 100);
  const forecast = committed + contingency;
  return { committed, paid, remaining, contingency, forecast, progress: forecast > 0 ? paid / forecast : 0, estimatesTotal };
}

export interface VendorFigures { adjusted: number; paid: number; remaining: number; count: number; }

export function vendorFigures(vendorId: string, s: Snapshot): VendorFigures {
  let adjusted = 0, paid = 0, remaining = 0, count = 0;
  for (const c of s.commitments) {
    if (c.vendor_id !== vendorId) continue;
    count++;
    const f = commitmentFigures(c, s);
    paid += f.paid;
    if (c.status === 'cancelled') continue;
    adjusted += f.adjusted;
    remaining += Math.max(0, f.remaining);
  }
  return { adjusted, paid, remaining, count };
}

/** How much a new/edited payment would exceed the adjusted value (0 = fine). */
export function overpayment(c: Commitment, s: Pick<Snapshot, 'variations' | 'payments'>, amount: number, editingPaymentId?: string): number {
  const others = s.payments.filter((p) => p.id !== editingPaymentId);
  const f = commitmentFigures(c, { variations: s.variations, payments: others });
  return Math.max(0, f.paid + amount - f.adjusted);
}

export function paymentHasProof(p: Payment, links: DocLink[]): boolean {
  return links.some((l) => l.entity_type === 'payment' && l.entity_id === p.id);
}

export function paymentsWithoutProof(payments: Payment[], links: DocLink[]): Payment[] {
  const linked = new Set(links.filter((l) => l.entity_type === 'payment').map((l) => l.entity_id));
  return payments.filter((p) => !linked.has(p.id));
}

export interface DuplicateCandidate { id?: string; amount: number; date: string; ref_no: string | null; vendor_id: string | null; }

export function findDuplicatePayments(
  cand: DuplicateCandidate, payments: Payment[], commitments: Commitment[], windowDays = 3,
): Payment[] {
  const vendorOf = new Map(commitments.map((c) => [c.id, c.vendor_id]));
  const ref = (cand.ref_no ?? '').trim().toLowerCase();
  return payments.filter((p) => {
    if (p.id === cand.id) return false;
    if (ref && (p.ref_no ?? '').trim().toLowerCase() === ref) return true;
    const sameVendor = cand.vendor_id !== null && vendorOf.get(p.commitment_id) === cand.vendor_id;
    return sameVendor && p.amount === cand.amount && Math.abs(daysBetween(p.date, cand.date)) <= windowDays;
  });
}

export function byCategory(s: Snapshot): { category: Category; forecast: number; paid: number }[] {
  const map = new Map<Category, { forecast: number; paid: number }>();
  for (const c of s.commitments) {
    const f = commitmentFigures(c, s);
    const row = map.get(c.category) ?? { forecast: 0, paid: 0 };
    row.paid += f.paid;
    row.forecast += c.status === 'cancelled' ? f.paid : Math.max(f.adjusted, f.paid);
    map.set(c.category, row);
  }
  return [...map.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.forecast - a.forecast);
}

export function byPayer(payments: Payment[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of payments) m.set(p.payer_id, (m.get(p.payer_id) ?? 0) + p.amount);
  return m;
}

/** Monthly spend for the last `months` months ending with the current one, keyed "YYYY-MM". */
export function byMonth(payments: Payment[], todayYmd: string, months = 12): { month: string; total: number }[] {
  const [y, m] = todayYmd.split('-').map(Number);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const totals = new Map(keys.map((k) => [k, 0]));
  for (const p of payments) {
    const k = p.date.slice(0, 7);
    if (totals.has(k)) totals.set(k, totals.get(k)! + p.amount);
  }
  return keys.map((k) => ({ month: k, total: totals.get(k)! }));
}
