/* Locale-aware formatting.
 *
 * Everything the owner reads goes through Intl with the property's locale, so
 * a German owner sees 03.04.2026 and a week starting Monday while an American
 * sees 4/3/2026 and a week starting Sunday — from the same data.  Dates are
 * parsed as *calendar dates*, never as instants: `new Date("2026-04-03")` is
 * UTC midnight and renders as the 2nd for anyone west of Greenwich, which is
 * how booking software quietly shifts people's arrival days.
 */

export function toLocalDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);          // local midnight, no timezone shift
}

export function isoOf(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(iso, days) {
  const date = toLocalDate(iso);
  date.setDate(date.getDate() + days);
  return isoOf(date);
}

export function nightsBetween(checkin, checkout) {
  return Math.round((toLocalDate(checkout) - toLocalDate(checkin)) / 86400000);
}

export function makeFormatters(locale, currency) {
  const safe = (fn, fallback) => {
    try { return fn(); } catch { return fallback(); }
  };
  const dayMonth = safe(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
    () => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }));
  const full = safe(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    () => new Intl.DateTimeFormat('en', { dateStyle: 'full' }));
  const weekday = safe(
    () => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }),
    () => new Intl.DateTimeFormat('en', { weekday: 'narrow' }));
  const money = safe(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'EUR' }),
    () => new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }));
  const percent = safe(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    () => new Intl.NumberFormat('en', { style: 'percent' }));
  const relative = safe(
    () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), () => null);

  return {
    shortDate: (iso) => dayMonth.format(toLocalDate(iso)),
    fullDate: (iso) => full.format(toLocalDate(iso)),
    weekdayNarrow: (iso) => weekday.format(toLocalDate(iso)),
    money: (cents) => money.format((cents || 0) / 100),
    percent: (ratio) => percent.format(ratio || 0),
    /* Which days the owner's own culture treats as the weekend — Friday and
       Saturday across much of the Middle East, not Saturday and Sunday. */
    isWeekend: (iso) => weekendDays(locale).includes(toLocalDate(iso).getDay()),
    ago: (isoStamp) => {
      if (!isoStamp || !relative) return null;
      const minutes = Math.round((Date.now() - new Date(isoStamp).getTime()) / 60000);
      if (!Number.isFinite(minutes)) return null;
      if (minutes < 60) return relative.format(-minutes, 'minute');
      if (minutes < 60 * 24) return relative.format(-Math.round(minutes / 60), 'hour');
      return relative.format(-Math.round(minutes / 1440), 'day');
    },
  };
}

const FRI_SAT = ['ar', 'he', 'fa', 'ur', 'dv'];

function weekendDays(locale) {
  const base = String(locale || 'en').split('-')[0].toLowerCase();
  return FRI_SAT.includes(base) ? [5, 6] : [0, 6];
}

/* Simple {placeholder} interpolation — the whole templating the UI needs. */
export function interpolate(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values || {}, key) ? values[key] : match);
}
