import type {
  Category, CommitmentStatus, CommitmentType, DocType, MilestoneStatus, PaymentMethod, VariationStatus, EntityType,
} from './types';

export const CATEGORY: Record<Category, string> = {
  design_supervision: 'إشراف وتصاميم',
  structure: 'هيكل أسود',
  electrical: 'كهرباء',
  plumbing: 'صحي',
  hvac: 'تكييف',
  aluminium_windows: 'ألمنيوم ونوافذ',
  doors: 'أبواب',
  kitchen: 'مطابخ',
  tiles_flooring: 'بلاط وأرضيات',
  sanitary_ware: 'أدوات صحية',
  lighting: 'إنارة',
  paint: 'دهانات',
  gypsum: 'جبس',
  insulation: 'عزل',
  gov_fees_utilities: 'رسوم حكومية وتوصيلات',
  other: 'أخرى',
};

export const COMMITMENT_TYPE: Record<CommitmentType, string> = {
  staged_contract: 'عقد بدفعات',
  direct_purchase: 'شراء مباشر',
  estimate: 'بند متوقع',
};

export const COMMITMENT_STATUS: Record<CommitmentStatus, string> = {
  estimated: 'متوقع',
  approved: 'معتمد',
  fully_paid: 'مكتمل الدفع',
  cancelled: 'ملغي',
};

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  bank_transfer: 'تحويل بنكي',
  cheque: 'شيك',
  cash: 'نقد',
  card: 'بطاقة',
  benefitpay: 'BenefitPay',
};

export const MILESTONE_STATUS: Record<MilestoneStatus, string> = {
  not_due: 'لم تستحق',
  due: 'مستحقة',
  partially_paid: 'مدفوعة جزئياً',
  paid: 'مدفوعة',
};

export const VARIATION_STATUS: Record<VariationStatus, string> = {
  proposed: 'مقترح',
  approved: 'معتمد',
  rejected: 'مرفوض',
};

export const DOC_TYPE: Record<DocType, string> = {
  contract: 'عقد',
  quotation: 'عرض سعر',
  invoice: 'فاتورة',
  receipt: 'سند قبض',
  transfer_slip: 'إيصال تحويل',
  cheque: 'صورة شيك',
  drawing: 'مخطط',
  permit: 'رخصة',
  correspondence: 'مراسلة',
  site_photo: 'صورة موقع',
  other: 'أخرى',
};

export const ENTITY: Record<EntityType | 'project' | 'payer' | 'document' | 'document_link', string> = {
  vendor: 'جهة',
  commitment: 'التزام',
  payment: 'دفعة',
  milestone: 'مرحلة',
  variation: 'أمر تغيير',
  project: 'المشروع',
  payer: 'دافع',
  document: 'مستند',
  document_link: 'ربط مستند',
};

export const ACTION: Record<string, string> = {
  insert: 'أضاف',
  update: 'عدّل',
  delete: 'حذف',
  restore: 'استرجع',
  purge: 'مسح نهائياً',
};

export const FIELD: Record<string, string> = {
  name: 'الاسم', title: 'العنوان', category: 'الفئة', amount: 'المبلغ', original_amount: 'القيمة الأصلية',
  date: 'التاريخ', method: 'طريقة الدفع', payer_id: 'من دفع', ref_no: 'رقم المرجع', notes: 'ملاحظات',
  status: 'الحالة', vendor_id: 'الجهة', commitment_id: 'الالتزام', milestone_id: 'المرحلة', reason: 'السبب',
  due_date: 'تاريخ الاستحقاق', due_trigger: 'شرط الاستحقاق', marked_due: 'مستحقة', contact_name: 'المسؤول',
  phone: 'الهاتف', cr_no: 'السجل التجاري', signed_date: 'تاريخ التوقيع', type: 'النوع', deleted_at: 'محذوف',
  contingency_pct: 'نسبة الاحتياطي', plot_no: 'رقم القطعة', location: 'الموقع', sort_order: 'الترتيب',
  retention_pct: 'نسبة المحتجز', retention_held: 'المحتجز',
};

export function options<T extends string>(rec: Record<T, string>): [T, string][] {
  return Object.entries(rec) as [T, string][];
}
