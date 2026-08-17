// Categories as the RESTAURANT ordered and named them. Settings → Menu stores
// menu_config.categories = [{ name, name_ar, sort }]; items still carry the category
// NAME. One helper, one rule, used by the PDF, the WhatsApp menu list, the tiered menu
// block, the "categories we serve" line and the category fast path — so the order a
// manager drags into place is the order every guest sees.
//   configured categories first, by `sort`; then any category that only exists on
//   items (never dropped — a dish never disappears because its section wasn't listed);
//   an empty configured category (no available dish) is skipped for guests.
export function orderedCategories(menu, config, { includeEmpty = false } = {}) {
  const items = Array.isArray(menu) ? menu : [];
  const onItems = [...new Set(items.map((m) => m?.category).filter(Boolean))];
  const configured = Array.isArray(config?.menu_config?.categories) ? config.menu_config.categories : [];
  const named = [...configured]
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
    .map((c) => ({ name: c.name.trim(), name_ar: (c.name_ar || "").trim() || null }));
  const seen = new Set(named.map((c) => c.name.toLowerCase()));
  const rest = onItems.filter((c) => !seen.has(String(c).toLowerCase())).map((c) => ({ name: c, name_ar: null }));
  const all = [...named, ...rest];
  return includeEmpty ? all : all.filter((c) => onItems.some((n) => String(n).toLowerCase() === c.name.toLowerCase()));
}
// The Arabic label for a category, when the restaurant gave one; else the English name.
export function categoryLabel(cat, lang = "en") {
  if (!cat) return "";
  return lang === "ar" && cat.name_ar ? cat.name_ar : cat.name;
}
