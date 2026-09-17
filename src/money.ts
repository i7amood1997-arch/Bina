// Money is always integer fils. 1 BD = 1000 fils.
const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Convert Arabic-Indic / Persian digits and separators to Latin. */
export function latinize(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[٬،]/g, ',');
}

/** Parse user text ("1,500.5", "١٥٠٠٫٥", "1500") into fils. Returns null when not a number. */
export function parseFils(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 1000) : null;
  const s = latinize(input).replace(/[,\s]/g, '').replace(/BD|د\.?ب\.?/gi, '');
  if (!/^-?\d*\.?\d*$/.test(s) || s === '' || s === '-' || s === '.') return null;
  const neg = s.startsWith('-');
  const [intPart, fracPart = ''] = s.replace('-', '').split('.');
  const frac = (fracPart + '000').slice(0, 3);
  const extra = fracPart.length > 3 ? Number(fracPart[3]) : 0; // round half up on 4th decimal
  let fils = Number(intPart || '0') * 1000 + Number(frac) + (extra >= 5 ? 1 : 0);
  if (neg) fils = -fils;
  return fils;
}

// Wrapped in LTR isolates (U+2066…U+2069) so amounts stay intact inside Arabic sentences.
const LRI = '\u2066';
const PDI = '\u2069';
export function formatBD(fils: number, withUnit = true): string {
  const s = nf.format(fils / 1000);
  return withUnit ? `${LRI}${s} BD${PDI}` : `${LRI}${s}${PDI}`;
}
export const stripIsolates = (s: string) => s.replace(/[\u2066-\u2069]/g, '');

/** Compact form for tight spaces: 12,500 BD (drops fils when zero). */
export function formatBDShort(fils: number): string {
  return fils % 1000 === 0 ? `${LRI}${nf0.format(fils / 1000)} BD${PDI}` : formatBD(fils);
}

/** Value for an <input> (no grouping). */
export function filsToInput(fils: number | null | undefined): string {
  if (fils === null || fils === undefined) return '';
  return (fils / 1000).toFixed(3).replace(/\.?0+$/, '');
}

export function pct(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0%';
  return `${Math.round(ratio * 100)}%`;
}
