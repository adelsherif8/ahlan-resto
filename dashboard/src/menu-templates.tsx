// Menu design templates — each takes the restaurant's real data (name, logo, brand
// colour, tagline, categories with items + photos) and renders a branded, print-width
// (794px ≈ A4@96dpi) menu. The designer page rasterizes the chosen one to a PDF.
//
// Templates only use system fonts and solid colours so html2canvas rasterizes them
// faithfully; item photos load with crossOrigin so they survive the canvas export.

export type Item = { name: string; price: number | null; description?: string; photo_url?: string; bestseller?: boolean };
export type Section = { cat: string; items: Item[]; hero?: string };
export type MenuData = { name: string; logo?: string; accent: string; tagline?: string; phone?: string; currency: string; sections: Section[] };

export const TEMPLATES = [
  { key: "bold", label: "Bold" },
  { key: "smash", label: "Smash" },
  { key: "clean", label: "Clean" },
];

const W = 794;
const money = (p: number | null, cur: string) => (p == null ? "" : `${p} ${cur}`);
const img = (src?: string) => (src ? <img src={src} crossOrigin="anonymous" style={{ display: "block", objectFit: "cover", width: "100%", height: "100%" }} alt="" /> : null);

function Leader({ item, cur, color = "#111" }: { item: Item; cur: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginBottom: 7 }}>
      <span style={{ fontWeight: 700, color, whiteSpace: "nowrap" }}>{item.name}</span>
      <span style={{ flex: 1, borderBottom: "1.5px dotted #bbb", transform: "translateY(-4px)" }} />
      <span style={{ fontWeight: 800, color, whiteSpace: "nowrap" }}>{money(item.price, cur)}</span>
    </div>
  );
}

export function MenuTemplate({ template, data }: { template: string; data: MenuData }) {
  if (template === "smash") return <SmashMenu data={data} />;
  if (template === "clean") return <CleanMenu data={data} />;
  return <BoldMenu data={data} />;
}

// ---------- BOLD: dark, accent panels, a hero photo per section ----------
function BoldMenu({ data }: { data: MenuData }) {
  const { name, logo, accent, currency, sections } = data;
  return (
    <div style={{ width: W, background: "#171310", color: "#fff", fontFamily: "Arial, Helvetica, sans-serif", padding: "40px 44px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 62, fontWeight: 900, lineHeight: 0.9, letterSpacing: -1 }}>MENU</div>
          {data.tagline && <div style={{ color: accent, fontWeight: 700, marginTop: 8, fontSize: 15 }}>{data.tagline}</div>}
        </div>
        {logo ? <div style={{ width: 88, height: 88, borderRadius: 16, overflow: "hidden", background: "#fff" }}>{img(logo)}</div>
          : <div style={{ fontSize: 22, fontWeight: 900, color: accent }}>{name.toUpperCase()}</div>}
      </div>

      {sections.map((s, i) => (
        <div key={s.cat} style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "stretch", flexDirection: i % 2 ? "row-reverse" : "row" }}>
          <div style={{ flex: 1, background: accent, borderRadius: 18, padding: "16px 20px", color: "#171310" }}>
            <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 10, letterSpacing: 0.5 }}>{s.cat.toUpperCase()}</div>
            {s.items.slice(0, 8).map((it) => <Leader key={it.name} item={it} cur={currency} color="#171310" />)}
          </div>
          {s.hero && <div style={{ width: 230, borderRadius: 18, overflow: "hidden", background: "#221" }}>{img(s.hero)}</div>}
        </div>
      ))}

      <div style={{ textAlign: "center", color: "#8a8079", fontSize: 12, marginTop: 20 }}>
        {[name, data.phone].filter(Boolean).join("   ·   ")} · Prices are VAT inclusive
      </div>
    </div>
  );
}

// ---------- SMASH: red header, big hero on the left, two-column list ----------
function SmashMenu({ data }: { data: MenuData }) {
  const { name, logo, accent, currency, sections } = data;
  const hero = sections.find((s) => s.hero)?.hero;
  const flat = sections.flatMap((s) => s.items.map((it) => ({ ...it, cat: s.cat })));
  const mid = Math.ceil(flat.length / 2);
  const cols = [flat.slice(0, mid), flat.slice(mid)];
  return (
    <div style={{ width: W, background: "#151515", color: "#fff", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div style={{ background: accent, padding: "26px 40px", display: "flex", alignItems: "center", gap: 14 }}>
        {logo && <div style={{ width: 54, height: 54, borderRadius: 12, overflow: "hidden", background: "#fff" }}>{img(logo)}</div>}
        <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 2 }}>{name.toUpperCase()}</div>
      </div>
      <div style={{ display: "flex" }}>
        {hero && <div style={{ width: 250, alignSelf: "stretch" }}>{img(hero)}</div>}
        <div style={{ flex: 1, display: "flex", gap: 26, padding: "26px 30px" }}>
          {cols.map((col, ci) => (
            <div key={ci} style={{ flex: 1 }}>
              {col.map((it) => (
                <div key={it.name + it.cat} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{it.name.toUpperCase()}</span>
                    <span style={{ fontWeight: 800, color: accent }}>{money(it.price, currency)}</span>
                  </div>
                  {it.description && <div style={{ color: "#b3b3b3", fontSize: 11, marginTop: 2, lineHeight: 1.35 }}>{it.description}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div style={{ textAlign: "center", color: "#888", fontSize: 11, padding: "10px 0 20px" }}>
        {[name, data.phone].filter(Boolean).join("   ·   ")} · Prices are VAT inclusive
      </div>
    </div>
  );
}

// ---------- CLEAN: light, two-column, small hero ----------
function CleanMenu({ data }: { data: MenuData }) {
  const { name, logo, accent, currency, sections } = data;
  const hero = sections.find((s) => s.hero)?.hero;
  const mid = Math.ceil(sections.length / 2);
  const cols = [sections.slice(0, mid), sections.slice(mid)];
  return (
    <div style={{ width: W, background: "#fbf7f2", color: "#2a2320", fontFamily: "Georgia, 'Times New Roman', serif", padding: "40px 44px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, borderBottom: `3px solid ${accent}`, paddingBottom: 16, marginBottom: 22 }}>
        {logo && <div style={{ width: 60, height: 60, borderRadius: "50%", overflow: "hidden", background: "#fff", border: `2px solid ${accent}` }}>{img(logo)}</div>}
        <div>
          <div style={{ fontSize: 34, fontWeight: 700, color: accent }}>{name}</div>
          {data.tagline && <div style={{ fontSize: 13, color: "#8a7f76", fontStyle: "italic" }}>{data.tagline}</div>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 34 }}>
        {cols.map((colSecs, ci) => (
          <div key={ci} style={{ flex: 1 }}>
            {colSecs.map((s) => (
              <div key={s.cat} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 19, fontWeight: 700, color: accent, marginBottom: 10 }}>{s.cat}</div>
                {s.items.map((it) => (
                  <div key={it.name} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontFamily: "Arial, sans-serif", fontSize: 13.5 }}>{it.name}</span>
                      <span style={{ fontWeight: 700, color: accent, fontFamily: "Arial, sans-serif" }}>{money(it.price, currency)}</span>
                    </div>
                    {it.description && <div style={{ fontSize: 11.5, color: "#8a7f76", fontFamily: "Arial, sans-serif", lineHeight: 1.4 }}>{it.description}</div>}
                  </div>
                ))}
              </div>
            ))}
            {ci === cols.length - 1 && hero && <div style={{ width: "100%", height: 150, borderRadius: 12, overflow: "hidden", marginTop: 6 }}>{img(hero)}</div>}
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", color: "#a89c92", fontSize: 11, marginTop: 20, fontFamily: "Arial, sans-serif" }}>
        {[name, data.phone].filter(Boolean).join("   ·   ")} · Prices are VAT inclusive
      </div>
    </div>
  );
}
