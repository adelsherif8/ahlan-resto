// The delivery COVERAGE MAP — where a restaurant draws the area it delivers to, drops
// its branch pin and marks the landmarks its guests name. Everything here is read by
// the bot's delivery engine (flows/src/services/delivery.js):
//   zone.polygon      [[lat,lng],…]  exact "inside?" check, no API
//   branch.lat/lng                   distance pricing starts here
//   delivery.landmarks [{name, aliases, lat, lng, kind:"place"|"area"}]
// Leaflet + OpenStreetMap tiles, leaflet-draw for the polygon. No keys, no cost.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
// leaflet-draw is a classic plugin: it patches the GLOBAL `L` at import time. Under
// Vite's production bundling it grabbed a different `L` and threw during module
// evaluation — which surfaced as "React error #321" in the whole Settings chunk.
// So: expose leaflet on window first, and load the plugin lazily inside the map init.
(window as any).L = L;
let drawReady: Promise<void> | null = null;
const loadDraw = () => (drawReady ||= import("leaflet-draw").then(() => undefined));
import { Btn, Input } from "../components/ui";

type LatLng = [number, number];
type Zone = { area?: string; polygon?: LatLng[]; lat?: number; lng?: number; radius_km?: number; [k: string]: any };
type Landmark = { name: string; aliases?: string[]; lat: number; lng: number; kind?: "place" | "area" };
type Branch = { key?: string; name?: string; lat?: number; lng?: number; [k: string]: any };

// leaflet's default marker icons don't survive bundlers — inline circle markers instead
const dot = (color: string, r = 7) => ({ radius: r, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 });

export default function DeliveryMap({
  zones, branches, landmarks, pricing, onChange,
}: {
  zones: Zone[];
  branches: Branch[];
  landmarks: Landmark[];
  pricing: any;
  onChange: (patch: { zones?: Zone[]; branches?: Branch[]; landmarks?: Landmark[] }) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnRef = useRef<L.FeatureGroup | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const [mode, setMode] = useState<"select" | "branch" | "landmark" | "area">("select");
  const [zoneIdx, setZoneIdx] = useState(0);
  const [cityQ, setCityQ] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);              // synchronous, unlike the state above
  const zonesRef = useRef<any[]>(zones);      // always the newest zones, not the click's
  zonesRef.current = zones;
  const [ready, setReady] = useState(0);
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode; }, [mode]);
  const zoneIdxRef = useRef(zoneIdx); useEffect(() => { zoneIdxRef.current = zoneIdx; }, [zoneIdx]);
  const stateRef = useRef({ zones, branches, landmarks }); useEffect(() => { stateRef.current = { zones, branches, landmarks }; }, [zones, branches, landmarks]);
  const zone = zones[zoneIdx] || null;

  // ---- init once ----
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    let cancelled = false;
    let mapLocal: L.Map | null = null;
    loadDraw().then(() => {
    if (cancelled || !mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: true });
    mapLocal = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const drawn = new L.FeatureGroup().addTo(map);
    const overlay = L.layerGroup().addTo(map);
    mapRef.current = map; drawnRef.current = drawn; overlayRef.current = overlay;

    // draw control: polygons only (the coverage boundary), edit/delete on the drawn layer
    const ctl = new (L.Control as any).Draw({
      position: "topright",
      draw: { polygon: { allowIntersection: false, showArea: false, shapeOptions: { color: "#f59e0b", weight: 2, fillOpacity: 0.15 } }, polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false },
      edit: { featureGroup: drawn, remove: true },
    });
    map.addControl(ctl);
    const commit = () => {
      // whatever is drawn is THE polygon of the selected zone
      const layers = drawn.getLayers() as L.Polygon[];
      const poly = layers.length ? (layers[layers.length - 1].getLatLngs()[0] as L.LatLng[]).map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5)] as LatLng) : [];
      const zs = [...stateRef.current.zones];
      const i = Math.min(zoneIdxRef.current, Math.max(0, zs.length - 1));
      if (!zs.length) zs.push({ area: "Delivery area", aliases: [] });
      zs[i] = { ...zs[i], polygon: poly.length >= 3 ? poly : undefined };
      onChange({ zones: zs });
    };
    map.on((L as any).Draw.Event.CREATED, (e: any) => { drawn.clearLayers(); drawn.addLayer(e.layer); commit(); });
    map.on((L as any).Draw.Event.EDITED, commit);
    map.on((L as any).Draw.Event.DELETED, commit);

    // click-to-place for branch / landmark / area
    map.on("click", (e: L.LeafletMouseEvent) => {
      const m = modeRef.current;
      const { lat, lng } = e.latlng;
      const p = { lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
      if (m === "branch") {
        const bs = [...stateRef.current.branches];
        if (!bs.length) bs.push({ key: "main", name: "Main branch" });
        bs[0] = { ...bs[0], ...p };
        onChange({ branches: bs });
        setMode("select");
      } else if (m === "landmark" || m === "area") {
        const name = window.prompt(m === "area" ? "District / area name (e.g. El Narges)" : "Landmark name (e.g. Point 90 Mall)");
        if (!name) return;
        onChange({ landmarks: [...stateRef.current.landmarks, { name: name.trim(), aliases: [], ...p, kind: m === "area" ? "area" : "place" }] });
        setMode("select");
      }
    });
    map.setView([30.03, 31.47], 12);
    setReady((n) => n + 1);
    });
    return () => { cancelled = true; if (mapLocal) { mapLocal.remove(); } mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- redraw when data changes ----
  useEffect(() => {
    const map = mapRef.current, drawn = drawnRef.current, overlay = overlayRef.current;
    if (!map || !drawn || !overlay) return;
    drawn.clearLayers(); overlay.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    zones.forEach((z, i) => {
      if (z.polygon && z.polygon.length >= 3) {
        const poly = L.polygon(z.polygon, { color: i === zoneIdx ? "#f59e0b" : "#a1a1aa", weight: 2, fillColor: "#f59e0b", fillOpacity: i === zoneIdx ? 0.15 : 0.05 });
        if (i === zoneIdx) drawn.addLayer(poly); else overlay.addLayer(poly.bindTooltip(z.area || "zone"));
        z.polygon.forEach((p) => bounds.push(p));
      } else if (typeof z.lat === "number" && typeof z.lng === "number") {
        overlay.addLayer(L.circle([z.lat, z.lng], { radius: (z.radius_km || 5) * 1000, color: "#f59e0b", weight: 1, dashArray: "4 4", fillOpacity: 0.06 }).bindTooltip(`${z.area || "zone"} — ${z.radius_km || 5} km circle (draw a boundary to replace it)`));
        bounds.push([z.lat, z.lng]);
      }
    });
    branches.forEach((b) => {
      if (typeof b.lat !== "number") return;
      overlay.addLayer(L.circleMarker([b.lat, b.lng!], dot("#ef4444", 9)).bindTooltip(`Branch: ${b.name || "main"}`));
      if (pricing?.mode === "distance" && Number(pricing.base_km) > 0) {
        overlay.addLayer(L.circle([b.lat, b.lng!], { radius: (Number(pricing.base_km) * 1000) / (Number(pricing.road_factor) || 1.3), color: "#22c55e", weight: 1, dashArray: "4 4", fillOpacity: 0.03 }).bindTooltip(`≈ ${pricing.base_km} km road → base fee ${pricing.base_fee} EGP`));
      }
      bounds.push([b.lat, b.lng!]);
    });
    landmarks.forEach((l, i) => {
      const m = L.circleMarker([l.lat, l.lng], dot(l.kind === "area" ? "#38bdf8" : "#a78bfa", l.kind === "area" ? 6 : 5)).bindTooltip(l.name);
      m.on("click", () => { if (modeRef.current === "select") { const nm = window.prompt(`Rename (empty = delete): ${l.name}`, l.name); if (nm === null) return; const next = [...stateRef.current.landmarks]; if (!nm.trim()) next.splice(i, 1); else next[i] = { ...next[i], name: nm.trim() }; onChange({ landmarks: next }); } });
      overlay.addLayer(m);
      bounds.push([l.lat, l.lng]);
    });
    if (bounds.length && !(map as any)._fitDone) { map.fitBounds(L.latLngBounds(bounds as any).pad(0.08)); (map as any)._fitDone = true; }
  }, [zones, branches, landmarks, pricing, zoneIdx, ready]);

  // ---- helpers ----
  async function loadCityBoundary() {
    if (!cityQ.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&polygon_geojson=1&q=${encodeURIComponent(cityQ.trim())}`, { headers: { "Accept-Language": "en" } });
      const j = await r.json();
      const g = j?.[0]?.geojson;
      let ring: number[][] | null = null;
      if (g?.type === "Polygon") ring = g.coordinates[0];
      else if (g?.type === "MultiPolygon") ring = [...g.coordinates].sort((a: any, b: any) => b[0].length - a[0].length)[0][0];
      if (!ring) { alert("No boundary found for that name — try the official city/district name, or draw it by hand."); return; }
      // simplify to ~80 m so config stays small
      const dp = (pts: number[][], eps: number): number[][] => { if (pts.length < 3) return pts; const a = pts[0], b = pts[pts.length - 1]; let mi = 0, md = 0; for (let i = 1; i < pts.length - 1; i++) { const p = pts[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-12); const cx = a[0] + t * dx, cy = a[1] + t * dy; const d = Math.hypot(p[0] - cx, p[1] - cy); if (d > md) { md = d; mi = i; } } return md > eps ? [...dp(pts.slice(0, mi + 1), eps).slice(0, -1), ...dp(pts.slice(mi), eps)] : [a, b]; };
      const poly = dp(ring, 0.0008).map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)] as LatLng);
      const live = zonesRef.current;
      const zs = [...live]; if (!zs.length) zs.push({ area: cityQ.trim(), aliases: [] });
      zs[Math.min(zoneIdx, zs.length - 1)] = { ...zs[Math.min(zoneIdx, zs.length - 1)], polygon: poly, polygon_source: `OSM: ${j[0].display_name}` };
      onChange({ zones: zs });
      (mapRef.current as any)._fitDone = false;
    } catch (e: any) { alert(e.message || "Lookup failed"); } finally { busyRef.current = false; setBusy(false); }
  }

  const branch = branches[0];
  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-400">Zone:</span>
        <select className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" value={zoneIdx} onChange={(e) => setZoneIdx(Number(e.target.value))}>
          {zones.map((z, i) => <option key={i} value={i}>{z.area || `zone ${i + 1}`}{z.polygon?.length ? " ✓ boundary" : z.lat != null ? " ○ circle" : " — nothing yet"}</option>)}
          {!zones.length && <option value={0}>— add a zone above first —</option>}
        </select>
        <span className="mx-1 text-zinc-700">|</span>
        <Btn variant={mode === "branch" ? "primary" : "ghost"} className="px-2 py-1 text-xs" onClick={() => setMode(mode === "branch" ? "select" : "branch")}>📍 {branch?.lat != null ? "Move branch pin" : "Place branch pin"}</Btn>
        <Btn variant={mode === "landmark" ? "primary" : "ghost"} className="px-2 py-1 text-xs" onClick={() => setMode(mode === "landmark" ? "select" : "landmark")}>+ Landmark</Btn>
        <Btn variant={mode === "area" ? "primary" : "ghost"} className="px-2 py-1 text-xs" onClick={() => setMode(mode === "area" ? "select" : "area")}>+ District</Btn>
        <span className="mx-1 text-zinc-700">|</span>
        <Input className="w-56 py-1 text-xs" placeholder="Load official boundary: e.g. New Cairo, Egypt" value={cityQ} onChange={(e) => setCityQ(e.target.value)} />
        <Btn variant="ghost" className="px-2 py-1 text-xs" onClick={loadCityBoundary} disabled={busy || !cityQ.trim()}>{busy ? "Loading…" : "Load"}</Btn>
      </div>
      <div ref={mapEl} className="h-[460px] w-full overflow-hidden rounded-xl border border-zinc-800" style={{ cursor: mode === "select" ? "grab" : "crosshair" }} />
      <p className="mt-2 text-xs text-zinc-500">
        {mode === "select" && <>Use the ▲ polygon tool (top-right) to draw the delivery area, or the edit tool to move its corners; click a dot to rename/delete a landmark. <span className="text-amber-400">Amber</span> = covered area · <span className="text-red-400">red</span> = branch · <span className="text-sky-400">blue</span> = district (used as an approximate point when a street can't be placed) · <span className="text-violet-400">purple</span> = landmark (malls, compounds — matched by name, zero cost).</>}
        {mode === "branch" && <>Click the map where the branch is. Distance pricing measures from here.</>}
        {mode === "landmark" && <>Click the map on the landmark, then name it. Add Arabic/Franco aliases in the list below.</>}
        {mode === "area" && <>Click the centre of the district (e.g. Narges 4), then name it.</>}
      </p>
      {/* landmark list: aliases + kind + delete */}
      {landmarks.length > 0 && (
        <div className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 p-2">
          {landmarks.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2 text-xs">
              <Input className="col-span-3 py-1 text-xs" value={l.name} onChange={(e) => { const n = [...landmarks]; n[i] = { ...n[i], name: e.target.value }; onChange({ landmarks: n }); }} />
              <Input className="col-span-6 py-1 text-xs" placeholder="aliases: بوينت 90, point90 (comma-separated)" value={(l.aliases || []).join(", ")} onChange={(e) => { const n = [...landmarks]; n[i] = { ...n[i], aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }; onChange({ landmarks: n }); }} />
              <select className="col-span-2 rounded-lg border border-zinc-700 bg-zinc-900 px-1 py-1 text-xs" value={l.kind || "place"} onChange={(e) => { const n = [...landmarks]; n[i] = { ...n[i], kind: e.target.value as any }; onChange({ landmarks: n }); }}>
                <option value="place">landmark</option><option value="area">district</option>
              </select>
              <button className="col-span-1 text-zinc-500 hover:text-red-400" title="Remove" onClick={() => onChange({ landmarks: landmarks.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
