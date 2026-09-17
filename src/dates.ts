const dfLong = new Intl.DateTimeFormat('ar-BH-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const dfShort = new Intl.DateTimeFormat('ar-BH-u-nu-latn', { day: 'numeric', month: 'short' });
const dfMonth = new Intl.DateTimeFormat('ar-BH-u-nu-latn', { month: 'short', year: 'numeric' });
const tf = new Intl.DateTimeFormat('ar-BH-u-nu-latn', { hour: 'numeric', minute: '2-digit' });

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parse(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function fmtDate(ymd: string | null | undefined): string {
  return ymd ? dfLong.format(parse(ymd)) : '';
}
export function fmtDateShort(ymd: string | null | undefined): string {
  return ymd ? dfShort.format(parse(ymd)) : '';
}
export function fmtMonth(ym: string): string {
  return dfMonth.format(parse(`${ym}-01`));
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}
/** "اليوم 8:14م", "أمس 8:14م", or a date. */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const t = tf.format(d);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const diff = daysBetween(ymd, today());
  if (diff === 0) return `اليوم ${t}`;
  if (diff === 1) return `أمس ${t}`;
  return `${fmtDateShort(ymd)} ${t}`;
}
