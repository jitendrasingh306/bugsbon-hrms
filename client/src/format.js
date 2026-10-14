// Display timezone for the company (matches COMPANY_TIMEZONE on the server).
export const COMPANY_TZ = 'Asia/Kolkata';

export function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: COMPANY_TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const CATEGORIES = [
  ['sales', 'Sales'], ['development', 'Development'], ['testing', 'Testing'], ['hr', 'HR'], ['design', 'Design'], ['other', 'Other'],
];
export const categoryLabel = (k) => (CATEGORIES.find(([v]) => v === k) || [k, k])[1];

export function formatDay(key) {
  if (!key) return '';
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function shiftDay(key, days) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function formatMinutes(m) {
  if (!m) return '0h';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}
