/** Small, dependency-free formatters (Hermes' Intl coverage varies by build). */

/** 137439 → "137,439" */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 0.0042 → "<$0.01", 0 → "$0.00", 1.5 → "$1.50" */
export function fmtCost(cost: number | undefined | null): string {
  if (cost == null || !Number.isFinite(cost)) return '—';
  if (cost > 0 && cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 1792000000000 → "Oct 14, 2026, 6:32 AM" */
export function fmtDateTime(ms: number | undefined | null): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h}:${min} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** 74 → "1m 14s" */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
