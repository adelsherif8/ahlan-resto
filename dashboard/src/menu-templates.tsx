// Menu design templates — each takes the restaurant's real data (name, logo, brand
// colour, tagline, categories with items + photos) and renders a branded, print-width
// (794px ≈ A4@96dpi) menu. The designer page rasterizes the chosen one to a PDF.
//
// Palette comes from the BRAND, not a hardcoded look: accent = brand.primary, and the
// ground is white unless the brand is explicitly dark. Templates use only system fonts
// and solid colours so html2canvas rasterizes them faithfully; item photos load with
// crossOrigin so they survive the canvas export.

export type Item = { name: string; price: number | null; description?: string; photo_url?: string; bestseller?: boolean };
export type Section = { cat: string; items: Item[]; hero?: string };
export type MenuData = {
  name: string; logo?: string; accent: string; dark?: boolean;
  tagline?: string; phone?: string; currency: string; sections: Section[];
};

export const TEMPLATES = [
  { key: "bold", label: "Bold" },
  { key: "smash", label: "Smash" },
  { key: "clean", label: "Clean" },
];

const W = 794;
const money = (p: number | null, cur: string) => (p == null ? "" : `${p} ${cur}`);
const img = (src?: string) => (src ? <img src={src} crossOrigin="anonymous" style={{ display: "block", objectFit: "cover", width: "100%", height: "100%" }} alt="" /> : null);

export function MenuTemplate({ template, data }: { template: string; data: MenuData }) {
  if (template === "smash") return <SmashMenu data={data} />;
  if (template === "clean") return <CleanMenu data={data} />;
  return <BoldMenu data={data} />;
}

// ---------- BOLD: white ground, red section panels (white text), hero photos ----------
function BoldMenu({ data }: { data: MenuData }) {
  const { name, logo, accent, currency, sections } = data;
  return (
    <div style={{ width: W, background: "#ffffff", color: "#17110f", fontFamily: "Arial, Helvetica, sans-serif", padding: "40px 44px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 26 }}>
        <div>
          <div style={{ fontSize: 62, fontWeight: 900, lineHeight: 0.9, letterSpacing: -1, color: accent }}>MENU</div>
          {data.tagline && <div style={{ color: "#7a7168", fontWeight: 700, marginTop: 8, fontSize: 15 }}>{data.tagline}</div>}
        </div>
        {logo ? <div style={{ width: 88, height: 88, borderRadius: 18, overflow: "hidden", boxShadow: "0 6px 20px rgba(0,0,0,.12)" }}>{img(logo)}</div>
          : <div style={{ fontSize: 22, fontWeight: 900, color: accent }}>{name.toUpperCase()}</div>}
      </div>

      {sections.map((s, i) => (
        <div key={s.cat} style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "stretch", flexDirection: i % 2 ? "row-reverse" : "row" }}>
          <div style={{ flex: 1, background: accent, borderRadius: 18, padding: "16px 20px", color: "#fff" }}>
            <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 12, letterSpacing: 0.5 }}>{s.cat.toUpperCase()}</div>
            {s.items.slice(0, 16).map((it) => (
              <div key={it.name} style={{ display: "flex", alignItems: "flex-end", gap: 6, marginBottom: 8 }}>
                <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{it.name}</span>
                <span style={{ flex: 1, borderBottom: "1.5px dotted rgba(255,255,255,.55)", transform: "translateY(-4px)" }} />
                <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{money(it.price, currency)}</span>
              </div>
            ))}
          </div>
          {s.hero && <div style={{ width: 220, borderRadius: 18, overflow: "hidden", background: "#f2ede9" }}>{img(s.hero)}</div>}
        </div>
      ))}

      <div style={{ textAlign: "center", color: "#a89f97", fontSize: 12, marginTop: 20 }}>
        {[name, data.phone].filter(Boolean).join("   ·   ")} · Prices are VAT inclusive
      </div>
    </div>
  );
}

// ---------- SMASH: red header band, white body, two-column list ----------
function SmashMenu({ data }: { data: MenuData }) {
  const { name, logo, accent, currency, sections } = data;
  const hero = sections.find((s) => s.hero)?.hero;
  return (
    <div style={{ width: W, background: "#ffffff", color: "#17110f", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div style={{ background: accent, padding: "26px 40px", display: "flex", alignItems: "center", gap: 14, color: "#fff" }}>
        {logo && <div style={{ width: 54, height: 54, borderRadius: 12, overflow: "hidden", background: "#fff" }}>{img(logo)}</div>}
        <div>
          <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 2 }}>{name.toUpperCase()}</div>
          {data.tagline && <div style={{ fontSize: 13, opacity: 0.92 }}>{data.tagline}</div>}
        </div>
      </div>
      <div style={{ display: "flex" }}>
        {hero && <div style={{ width: 240, alignSelf: "stretch" }}>{img(hero)}</div>}
        <div style={{ flex: 1, padding: "24px 30px", columnCount: 2, columnGap: 26 }}>
          {sections.map((s) => (
            <div key={s.cat} style={{ breakInside: "avoid", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: accent, letterSpacing: 0.5, marginBottom: 8, borderBottom: `2px solid ${accent}`, paddingBottom: 3 }}>{s.cat.toUpperCase()}</div>
              {s.items.map((it) => (
                <div key={it.name} style={{ marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 13 }}>{it.name}</span>
                    <span style={{ fontWeight: 800, color: accent, whiteSpace: "nowrap" }}>{money(it.price, currency)}</span>
                  </div>
                  {it.description && <div style={{ color: "#8a8078", fontSize: 10.5, marginTop: 1, lineHeight: 1.35 }}>{it.description}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div style={{ textAlign: "center", color: "#a89f97", fontSize: 11, padding: "8px 0 18px" }}>
        {[name, data.phone].filter(Boolean).join("   ·   ")} · Prices are VAT inclusive
      </div>
    </div>
  );
}

// ---------- CLEAN: light, two-column, red accents, hero photo ----------
function CleanMenu({ data }: { data: MenuData }) {
  const { name, logo, accent, currency, sections } = data;
  const hero = sections.find((s) => s.hero)?.hero;
  return (
    <div style={{ width: W, background: "#fbf8f5", color: "#2a2320", fontFamily: "Georgia, 'Times New Roman', serif", padding: "40px 44px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, borderBottom: `3px solid ${accent}`, paddingBottom: 16, marginBottom: 22 }}>
        {logo && <div style={{ width: 62, height: 62, borderRadius: "50%", overflow: "hidden", border: `2px solid ${accent}` }}>{img(logo)}</div>}
        <div>
          <div style={{ fontSize: 34, fontWeight: 700, color: accent }}>{name}</div>
          {data.tagline && <div style={{ fontSize: 13, color: "#8a7f76", fontStyle: "italic" }}>{data.tagline}</div>}
        </div>
      </div>
      <div style={{ columnCount: 2, columnGap: 34 }}>
        {sections.map((s, i) => (
          <div key={s.cat} style={{ breakInside: "avoid", marginBottom: 20 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: accent, marginBottom: 10 }}>{s.cat}</div>
            {s.items.map((it) => (
              <div key={it.name} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontFamily: "Arial, sans-serif", fontSize: 13.5 }}>{it.name}</span>
                  <span style={{ fontWeight: 700, color: accent, fontFamily: "Arial, sans-serif", whiteSpace: "nowrap" }}>{money(it.price, currency)}</span>
                </div>
                {it.description && <div style={{ fontSize: 11.5, color: "#8a7f76", fontFamily: "Arial, sans-serif", lineHeight: 1.4 }}>{it.description}</div>}
              </div>
            ))}
            {i === 0 && hero && <div style={{ width: "100%", height: 150, borderRadius: 12, overflow: "hidden", marginTop: 6 }}>{img(hero)}</div>}
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", color: "#a89c92", fontSize: 11, marginTop: 20, fontFamily: "Arial, sans-serif" }}>
        {[name, data.phone].filter(Boolean).join("   ·   ")} · Prices are VAT inclusive
      </div>
    </div>
  );
}
