// AI document capture via the Anthropic Messages API, called directly from the device.
import { config, local } from './config';
import { store } from './db/store';
import { blobToBase64, isPdf } from './files';
import { latinize, parseFils } from './money';
import type { DocType, PaymentMethod } from './types';

export const getApiKey = () => local.get('anthropicKey');
export const setApiKey = (k: string | null) => local.set('anthropicKey', k && k.trim() ? k.trim() : null);

export interface ExtractedMilestone { title: string; amount_fils: number | null; due_trigger: string | null; }
export interface ExtractedExclusion { title: string; category: string | null; }

export interface Extraction {
  doc_type: DocType;
  vendor_name: string | null;
  vendor_match_id: string | null;
  amount_fils: number | null;
  currency: string | null;
  date: string | null;
  ref_no: string | null;
  method: PaymentMethod | null;
  description: string | null;
  commitment_match_id: string | null;
  milestone_match_id: string | null;
  milestones: ExtractedMilestone[];
  exclusions: ExtractedExclusion[];
  confidence: Record<string, number>;
}

const DOC_TYPES = ['contract', 'quotation', 'invoice', 'receipt', 'transfer_slip', 'cheque', 'drawing', 'permit', 'correspondence', 'site_photo', 'other'];
const METHODS = ['bank_transfer', 'cheque', 'cash', 'card', 'benefitpay'];
const CATEGORIES = ['design_supervision', 'structure', 'electrical', 'plumbing', 'hvac', 'aluminium_windows', 'doors', 'kitchen', 'tiles_flooring', 'sanitary_ware', 'lighting', 'paint', 'gypsum', 'insulation', 'gov_fees_utilities', 'other'];

function context() {
  const vendors = store.all('vendors').map((v) => ({ id: v.id, name: v.name, category: v.category }));
  const commitments = store.all('commitments').filter((c) => c.status !== 'cancelled').map((c) => ({
    id: c.id, vendor_id: c.vendor_id, title: c.title, type: c.type, amount_bd: c.original_amount / 1000, ref_no: c.ref_no,
  }));
  const milestones = store.all('milestones').map((m) => ({ id: m.id, commitment_id: m.commitment_id, title: m.title, amount_bd: m.amount / 1000 }));
  const corrections = store.all('ai_corrections')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 30)
    .map((c) => ({ field: c.field, extracted: c.extracted_value, corrected: c.corrected_value }));
  return { vendors, commitments, milestones, corrections };
}

const SYSTEM = `You extract structured data from documents related to building a private house in Bahrain
(receipts, bank transfer slips, cheques, invoices, quotations, contracts). Documents may be Arabic, English or mixed.
Respond with ONLY a JSON object, no prose and no markdown fences.

Schema:
{
  "doc_type": one of ${JSON.stringify(DOC_TYPES)},
  "vendor_name": string|null            // the party being paid / issuing the document, as written
  "vendor_match_id": string|null        // id from KNOWN_VENDORS if it is clearly the same party, else null
  "amount_bd": number|null              // total amount in Bahraini Dinars (3 decimals). For a receipt/transfer: the amount paid. For a contract/quotation: the total value.
  "currency": string|null               // "BHD" unless clearly otherwise
  "date": "YYYY-MM-DD"|null
  "ref_no": string|null                 // receipt no., transfer reference, cheque no., quotation/contract no.
  "method": one of ${JSON.stringify(METHODS)} or null
  "description": string|null            // short Arabic description of what was paid for (max 8 words)
  "commitment_match_id": string|null    // id from OPEN_COMMITMENTS this payment belongs to, if clear
  "milestone_match_id": string|null     // id from MILESTONES if the document names a specific stage, if clear
  "milestones": [{"title": string (Arabic), "amount_bd": number|null, "due_trigger": string|null}]  // payment schedule, contracts/quotations only, else []
  "exclusions": [{"title": string (Arabic), "category": one of ${JSON.stringify(CATEGORIES)} or null}] // items the document says the OWNER/CLIENT must supply or pay for, contracts/quotations only, else []
  "confidence": {"doc_type":0-1,"vendor":0-1,"amount":0-1,"date":0-1,"ref_no":0-1,"method":0-1,"commitment":0-1}
}

Rules:
- Convert Arabic-Indic digits to Latin digits.
- Never guess an id: use null when unsure.
- If a value is not on the document, use null and confidence 0.
- PAST_CORRECTIONS show how the user corrected earlier extractions; follow those mappings.`;

export async function extractDocument(blob: Blob): Promise<Extraction> {
  const key = getApiKey();
  if (!key) throw new Error('أضف مفتاح Claude API من الإعدادات أولاً');
  if (!navigator.onLine) throw new Error('القراءة الذكية تحتاج اتصالاً بالإنترنت');

  const data = await blobToBase64(blob);
  const media = isPdf(blob.type)
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data } };
  const ctx = context();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.aiModel,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          media,
          { type: 'text', text:
            `KNOWN_VENDORS: ${JSON.stringify(ctx.vendors)}\n` +
            `OPEN_COMMITMENTS: ${JSON.stringify(ctx.commitments)}\n` +
            `MILESTONES: ${JSON.stringify(ctx.milestones)}\n` +
            `PAST_CORRECTIONS: ${JSON.stringify(ctx.corrections)}\n\nExtract the JSON now.` },
        ],
      }],
    }),
  });
  if (res.status === 401) throw new Error('مفتاح Claude API غير صحيح');
  if (!res.ok) throw new Error(`تعذرت القراءة (${res.status})`);
  const body = await res.json();
  const text: string = (body.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return normalize(parseJson(text));
}

function parseJson(text: string): any {
  const clean = text.replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('لم أتمكن من فهم المستند');
  return JSON.parse(clean.slice(start, end + 1));
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? latinize(v.trim()) : null);
const amt = (v: unknown) => (v === null || v === undefined || v === '' ? null : parseFils(typeof v === 'number' ? v : String(v)));

function normalize(r: any): Extraction {
  const vendorId = str(r.vendor_match_id);
  const commitmentId = str(r.commitment_match_id);
  const milestoneId = str(r.milestone_match_id);
  const date = str(r.date);
  return {
    doc_type: DOC_TYPES.includes(r.doc_type) ? r.doc_type : 'other',
    vendor_name: str(r.vendor_name),
    vendor_match_id: vendorId && store.get('vendors', vendorId) ? vendorId : null,
    amount_fils: amt(r.amount_bd),
    currency: str(r.currency),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    ref_no: str(r.ref_no),
    method: METHODS.includes(r.method) ? r.method : null,
    description: str(r.description),
    commitment_match_id: commitmentId && store.get('commitments', commitmentId) ? commitmentId : null,
    milestone_match_id: milestoneId && store.get('milestones', milestoneId) ? milestoneId : null,
    milestones: Array.isArray(r.milestones) ? r.milestones.map((m: any) => ({
      title: str(m.title) ?? 'دفعة', amount_fils: amt(m.amount_bd), due_trigger: str(m.due_trigger),
    })) : [],
    exclusions: Array.isArray(r.exclusions) ? r.exclusions.map((x: any) => ({
      title: str(x.title) ?? '', category: CATEGORIES.includes(x.category) ? x.category : null,
    })).filter((x: ExtractedExclusion) => x.title) : [],
    confidence: typeof r.confidence === 'object' && r.confidence ? r.confidence : {},
  };
}

/** Store what the user changed so the next extraction learns from it. */
export function recordCorrections(ex: Extraction, final: { vendorId: string | null; vendorName: string | null; amount: number | null; date: string | null; docType: DocType }) {
  const add = (field: string, from: string | null, to: string | null) => {
    if ((from ?? '') === (to ?? '')) return;
    store.save('ai_corrections', { field, extracted_value: from, corrected_value: to, vendor_id: final.vendorId });
  };
  if (ex.vendor_match_id !== final.vendorId) add('vendor', ex.vendor_name, final.vendorName ? `${final.vendorName} (id ${final.vendorId})` : null);
  add('amount_bd', ex.amount_fils === null ? null : String(ex.amount_fils / 1000), final.amount === null ? null : String(final.amount / 1000));
  add('date', ex.date, final.date);
  add('doc_type', ex.doc_type, final.docType);
}
