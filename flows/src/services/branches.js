// Branch helpers — distances are CODE, never the LLM's guess.
const R = 6371; // km

export function distanceKm(aLat, aLng, bLat, bLng) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function branchList(config) {
  return (config?.basic_info?.branches || []).filter((b) => b && typeof b === "object" && b.key);
}

// nearest branches to a point, closest first
export function nearestBranches(branches, lat, lng, limit = 3) {
  return branches
    .filter((b) => typeof b.lat === "number" && typeof b.lng === "number")
    .map((b) => ({ ...b, km: Math.round(distanceKm(lat, lng, b.lat, b.lng) * 10) / 10 }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

// "I'm in Zayed" / "Heliopolis" → the branch whose name or address mentions it
const AREA_HINTS = {
  sheraton: ["sheraton", "شيراتون", "heliopolis east"],
  nasr_city: ["nasr city", "nasr", "مدينة نصر", "نصر"],
  new_cairo: ["new cairo", "tagamo", "tagamoa", "التجمع", "القاهرة الجديدة", "promenade", "90"],
  maadi: ["maadi", "المعادي", "zahraa"],
  sheikh_zayed: ["zayed", "الشيخ زايد", "زايد", "west arena", "6 october", "october", "اكتوبر"],
  roxy: ["roxy", "روكسي", "heliopolis", "مصر الجديدة", "korba"],
  alexandria: ["alex", "alexandria", "اسكندرية", "الإسكندرية", "sidi gaber", "سيدي جابر"],
  marina: ["marina", "مارينا", "north coast", "الساحل", "sahel", "alamein", "العلمين"],
  district9: ["haram", "الهرم", "district 9", "faisal", "فيصل", "giza", "الجيزة"],
};

export function matchBranchByText(branches, text) {
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  // exact-ish name match first
  const byName = branches.find((b) => t.includes(String(b.name).toLowerCase()));
  if (byName) return byName;
  for (const b of branches) {
    for (const hint of AREA_HINTS[b.key] || []) {
      if (t.includes(hint)) return b;
    }
  }
  return null;
}

// Map links guests paste: pull coordinates out, resolving short links by following
// the redirect (goo.gl / maps.app.goo.gl carry no coords until resolved).
export function extractMapLink(text) {
  const m = String(text || "").match(/https?:\/\/[^\s]*(?:google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo\.gl|goo\.gl\/maps|waze\.com)[^\s]*/i);
  return m ? m[0].replace(/[),.]+$/, "") : null;
}

export function coordsFromUrl(url) {
  const s = String(url || "");
  const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  const q = s.match(/[?&](?:q|ll|daddr|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/i);
  if (q) return { lat: Number(q[1]), lng: Number(q[2]) };
  const bang = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (bang) return { lat: Number(bang[1]), lng: Number(bang[2]) };
  return null;
}

export async function resolveMapLink(url) {
  const direct = coordsFromUrl(url);
  if (direct) return { url, ...direct };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);
    const finalCoords = coordsFromUrl(res.url) || coordsFromUrl(await res.text().then((x) => x.slice(0, 4000)).catch(() => ""));
    return { url, ...(finalCoords || {}) };
  } catch {
    return { url };
  }
}

// a location the guest shared recently enough to act on
export function freshLocation(diner, maxAgeHours = 6) {
  const l = diner?.preferences?.last_location;
  if (!l?.lat || !l?.lng) return null;
  if (l.at && Date.now() - new Date(l.at).getTime() > maxAgeHours * 3600_000) return null;
  return l;
}
