// money never reads "459.9" — whole numbers stay whole, fractions get two places
export function fmtMoney(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v)
    ? v.toLocaleString("en-US")
    : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
