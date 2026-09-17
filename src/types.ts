export type ID = string;

export interface Meta {
  id: ID;
  project_id: ID;
  created_by?: string | null;
  created_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
  deleted_at: string | null;
}

export type Category =
  | 'design_supervision' | 'structure' | 'electrical' | 'plumbing' | 'hvac'
  | 'aluminium_windows' | 'doors' | 'kitchen' | 'tiles_flooring' | 'sanitary_ware'
  | 'lighting' | 'paint' | 'gypsum' | 'insulation' | 'gov_fees_utilities' | 'other';

export type CommitmentType = 'staged_contract' | 'direct_purchase' | 'estimate';
export type CommitmentStoredStatus = 'estimated' | 'approved' | 'cancelled';
export type CommitmentStatus = CommitmentStoredStatus | 'fully_paid';
export type PaymentMethod = 'bank_transfer' | 'cheque' | 'cash' | 'card' | 'benefitpay';
export type MilestoneStatus = 'not_due' | 'due' | 'partially_paid' | 'paid';
export type VariationStatus = 'proposed' | 'approved' | 'rejected';
export type DocType =
  | 'contract' | 'quotation' | 'invoice' | 'receipt' | 'transfer_slip' | 'cheque'
  | 'drawing' | 'permit' | 'correspondence' | 'site_photo' | 'other';
export type EntityType = 'vendor' | 'commitment' | 'payment' | 'milestone' | 'variation';

export interface Project extends Meta { name: string; plot_no: string | null; location: string | null; contingency_pct: number; }
export interface Payer extends Meta { name: string; user_id: string | null; }
export interface Vendor extends Meta {
  name: string; category: Category; contact_name: string | null; phone: string | null; cr_no: string | null; notes: string | null;
}
export interface Commitment extends Meta {
  vendor_id: ID | null; type: CommitmentType; title: string; category: Category;
  original_amount: number; status: CommitmentStoredStatus; signed_date: string | null;
  retention_pct: number | null; ref_no: string | null; notes: string | null;
}
export interface Milestone extends Meta {
  commitment_id: ID; sort_order: number; title: string; amount: number;
  due_trigger: string | null; due_date: string | null; marked_due: boolean;
}
export interface Variation extends Meta {
  commitment_id: ID; title: string; amount: number; reason: string; date: string; status: VariationStatus;
}
export interface Payment extends Meta {
  commitment_id: ID; milestone_id: ID | null; kind: 'normal' | 'retention_release';
  amount: number; date: string; method: PaymentMethod; payer_id: ID;
  ref_no: string | null; retention_held: number; notes: string | null;
}
export interface Doc extends Meta {
  type: DocType; title: string; date: string | null; amount: number | null;
  drive_file_id: string | null; drive_url: string | null; file_name: string | null;
  mime: string | null; size: number | null; sha256: string | null;
}
export interface DocLink extends Meta { document_id: ID; entity_type: EntityType; entity_id: ID; }
export interface AiCorrection extends Meta { field: string; extracted_value: string | null; corrected_value: string | null; vendor_id: ID | null; }

export interface Member { project_id: ID; user_id: string; display_name: string; }

export interface AuditEntry {
  id: number | string; project_id: ID; entity_type: string; entity_id: ID;
  action: 'insert' | 'update' | 'delete' | 'restore' | 'purge';
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  user_id: string | null; at: string;
}

export interface Tables {
  projects: Project;
  payers: Payer;
  vendors: Vendor;
  commitments: Commitment;
  milestones: Milestone;
  variations: Variation;
  payments: Payment;
  documents: Doc;
  document_links: DocLink;
  ai_corrections: AiCorrection;
}
export type TableName = keyof Tables;
export const TABLES: TableName[] = [
  'projects', 'payers', 'vendors', 'commitments', 'milestones',
  'variations', 'payments', 'documents', 'document_links', 'ai_corrections',
];
export const dbTable = (t: string) => `hb_${t}`;
