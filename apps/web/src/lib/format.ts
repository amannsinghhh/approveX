/** ₹8,40,000 — Indian digit grouping (UI spec §5.1). */
export function formatINR(value: number): string {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)}`;
}

/** Best-effort amount extraction for list cards. */
export function payloadAmount(payload: unknown): number | null {
  if (payload === null || typeof payload !== 'object') return null;
  const amount = (payload as Record<string, unknown>).amount;
  if (typeof amount === 'number') return amount;
  if (typeof amount === 'string' && amount.trim() !== '' && !Number.isNaN(Number(amount))) {
    return Number(amount);
  }
  return null;
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
