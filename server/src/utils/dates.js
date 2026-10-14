import { env } from '../config/env.js';

/** 'YYYY-MM-DD' for an instant, in the company timezone (default Asia/Kolkata). */
export function dateKey(date = new Date(), timeZone = env.COMPANY_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export const todayKey = () => dateKey();

export const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Adds whole days to a date key (calendar arithmetic, timezone independent). */
export function addDays(key, days) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 'HH:MM' (24h) -> minutes since midnight. */
export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
