// money never reads "459.9" — whole numbers stay whole, fractions get two places
export function money(n: any): string {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function mins(since?: string | null): number {
  if (!since) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
}
