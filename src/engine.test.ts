import { describe, expect, it } from 'vitest';
import {
  byMonth, byPayer, commitmentFigures, findDuplicatePayments, milestoneStatus, overpayment,
  paymentsWithoutProof, projectFigures, scheduleGap, vendorFigures, type Snapshot,
} from './engine';
import { formatBD, parseFils, stripIsolates } from './money';
import type { Commitment, DocLink, Milestone, Payment, Variation } from './types';

const meta = { project_id: 'p', deleted_at: null };
let n = 0;
const id = () => `id${++n}`;

function commitment(o: Partial<Commitment>): Commitment {
  return { ...meta, id: id(), vendor_id: 'v1', type: 'staged_contract', title: 't', category: 'structure',
    original_amount: 0, status: 'approved', signed_date: null, retention_pct: null, ref_no: null, notes: null, ...o };
}
function payment(o: Partial<Payment>): Payment {
  return { ...meta, id: id(), commitment_id: '', milestone_id: null, kind: 'normal', amount: 0, date: '2026-09-01',
    method: 'bank_transfer', payer_id: 'ahmed', ref_no: null, retention_held: 0, notes: null, ...o };
}
function milestone(o: Partial<Milestone>): Milestone {
  return { ...meta, id: id(), commitment_id: '', sort_order: 0, title: 'm', amount: 0, due_trigger: null, due_date: null, marked_due: false, ...o };
}
function variation(o: Partial<Variation>): Variation {
  return { ...meta, id: id(), commitment_id: '', title: 'v', amount: 0, reason: 'r', date: '2026-09-01', status: 'approved', ...o };
}
const snap = (o: Partial<Snapshot>): Snapshot => ({ commitments: [], milestones: [], variations: [], payments: [], links: [], contingencyPct: 10, ...o });

describe('money', () => {
  it('parses and formats fils exactly', () => {
    expect(parseFils('35,000')).toBe(35_000_000);
    expect(parseFils('1500.5')).toBe(1_500_500);
    expect(parseFils('١٥٠٠٫٢٥')).toBe(1_500_250);
    expect(parseFils('0.1')).toBe(100);
    expect(parseFils('abc')).toBeNull();
    expect(stripIsolates(formatBD(12_500_000))).toBe('12,500.000 BD');
    expect(parseFils('0.1')! + parseFils('0.2')!).toBe(300);
  });
});

describe('35,000 BD contract with five milestones', () => {
  const c = commitment({ original_amount: parseFils('35000')! });
  const ms = [7000, 7000, 7000, 7000, 7000].map((a, i) => milestone({ commitment_id: c.id, amount: a * 1000, sort_order: i }));
  const payments = [
    payment({ commitment_id: c.id, milestone_id: ms[0].id, amount: 7_000_000 }),
    payment({ commitment_id: c.id, milestone_id: ms[1].id, amount: 3_500_250 }),
  ];
  it('gives exact paid and remaining', () => {
    const f = commitmentFigures(c, { variations: [], payments });
    expect(f.paid).toBe(10_500_250);
    expect(f.remaining).toBe(24_499_750);
    expect(f.status).toBe('approved');
  });
  it('derives milestone statuses', () => {
    expect(milestoneStatus(ms[0], payments, '2026-09-17')).toBe('paid');
    expect(milestoneStatus(ms[1], payments, '2026-09-17')).toBe('partially_paid');
    expect(milestoneStatus(ms[2], payments, '2026-09-17')).toBe('not_due');
    expect(milestoneStatus({ ...ms[2], marked_due: true }, payments, '2026-09-17')).toBe('due');
    expect(milestoneStatus({ ...ms[3], due_date: '2026-09-10' }, payments, '2026-09-17')).toBe('due');
  });
  it('checks schedule balance', () => {
    expect(scheduleGap(c, { milestones: ms, variations: [], payments })).toBe(0);
    const v = variation({ commitment_id: c.id, amount: 1_200_000 });
    expect(scheduleGap(c, { milestones: ms, variations: [v], payments })).toBe(1_200_000);
  });
});

describe('deposit then balance', () => {
  const c = commitment({ type: 'direct_purchase', original_amount: 2_000_000 });
  it('shows remaining then fully paid', () => {
    const p1 = payment({ commitment_id: c.id, amount: 500_000 });
    expect(commitmentFigures(c, { variations: [], payments: [p1] }).remaining).toBe(1_500_000);
    const p2 = payment({ commitment_id: c.id, amount: 1_500_000 });
    const f = commitmentFigures(c, { variations: [], payments: [p1, p2] });
    expect(f.remaining).toBe(0);
    expect(f.status).toBe('fully_paid');
  });
  it('warns on overpayment and respects variations', () => {
    const p1 = payment({ commitment_id: c.id, amount: 1_500_000 });
    expect(overpayment(c, { variations: [], payments: [p1] }, 700_000)).toBe(200_000);
    const v = variation({ commitment_id: c.id, amount: 200_000 });
    expect(overpayment(c, { variations: [v], payments: [p1] }, 700_000)).toBe(0);
    const rejected = variation({ commitment_id: c.id, amount: 200_000, status: 'rejected' });
    expect(overpayment(c, { variations: [rejected], payments: [p1] }, 700_000)).toBe(200_000);
    expect(overpayment(c, { variations: [], payments: [p1] }, 2_000_000, p1.id)).toBe(0);
  });
});

describe('project figures', () => {
  it('computes forecast with contingency on remaining, estimates and cancellations', () => {
    const a = commitment({ original_amount: 10_000_000 });
    const est = commitment({ status: 'estimated', type: 'estimate', original_amount: 2_000_000 });
    const cancelled = commitment({ status: 'cancelled', original_amount: 5_000_000 });
    const payments = [
      payment({ commitment_id: a.id, amount: 4_000_000 }),
      payment({ commitment_id: cancelled.id, amount: 300_000 }),
    ];
    const f = projectFigures(snap({ commitments: [a, est, cancelled], payments }));
    expect(f.paid).toBe(4_300_000);
    expect(f.remaining).toBe(8_000_000);          // 6,000 + 2,000
    expect(f.contingency).toBe(800_000);          // 10% of remaining
    expect(f.committed).toBe(12_300_000);         // 10,000 + 2,000 + 300 forfeited
    expect(f.forecast).toBe(13_100_000);
    expect(f.estimatesTotal).toBe(2_000_000);
    expect(vendorFigures('v1', snap({ commitments: [a, est, cancelled], payments })).paid).toBe(4_300_000);
  });
  it('restoring a deleted payment returns totals', () => {
    const a = commitment({ original_amount: 1_000_000 });
    const p = payment({ commitment_id: a.id, amount: 400_000 });
    const before = projectFigures(snap({ commitments: [a], payments: [p] }));
    const deleted = projectFigures(snap({ commitments: [a], payments: [] }));
    expect(deleted.paid).toBe(0);
    expect(projectFigures(snap({ commitments: [a], payments: [p] }))).toEqual(before);
  });
});

describe('proof, duplicates, summaries', () => {
  it('flags payments without proof', () => {
    const p1 = payment({ amount: 1 }); const p2 = payment({ amount: 2 });
    const links: DocLink[] = [{ ...meta, id: 'l', document_id: 'd', entity_type: 'payment', entity_id: p1.id }];
    expect(paymentsWithoutProof([p1, p2], links).map((p) => p.id)).toEqual([p2.id]);
  });
  it('finds duplicates by ref or vendor+amount within 3 days', () => {
    const c = commitment({ vendor_id: 'v9' });
    const p = payment({ commitment_id: c.id, amount: 1_500_000, date: '2026-09-10', ref_no: 'TRX-1' });
    expect(findDuplicatePayments({ amount: 1, date: '2026-01-01', ref_no: 'trx-1', vendor_id: null }, [p], [c])).toHaveLength(1);
    expect(findDuplicatePayments({ amount: 1_500_000, date: '2026-09-13', ref_no: null, vendor_id: 'v9' }, [p], [c])).toHaveLength(1);
    expect(findDuplicatePayments({ amount: 1_500_000, date: '2026-09-14', ref_no: null, vendor_id: 'v9' }, [p], [c])).toHaveLength(0);
    expect(findDuplicatePayments({ amount: 1_500_000, date: '2026-09-10', ref_no: null, vendor_id: 'other' }, [p], [c])).toHaveLength(0);
  });
  it('sums by payer and month', () => {
    const ps = [payment({ amount: 100, payer_id: 'a', date: '2026-09-02' }), payment({ amount: 50, payer_id: 'b', date: '2026-08-30' }), payment({ amount: 25, payer_id: 'a', date: '2025-01-01' })];
    expect(byPayer(ps).get('a')).toBe(125);
    const months = byMonth(ps, '2026-09-17', 12);
    expect(months).toHaveLength(12);
    expect(months.at(-1)).toEqual({ month: '2026-09', total: 100 });
    expect(months.at(-2)).toEqual({ month: '2026-08', total: 50 });
  });
});
