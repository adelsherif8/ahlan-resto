import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Check, Send, RotateCcw } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Empty } from "../components/ui";
import { MenuTemplate, TEMPLATES, type MenuData, type Section } from "../menu-templates";

// Build the template data from live menu items: group by category (menu sort order),
// pick the first photo in each category as its hero.
function toMenuData(items: any[], settings: any): MenuData {
  const bi = settings?.basic_info || {};
  const byCat = new Map<string, any[]>();
  for (const m of items) {
    if (m.available === false) continue;
    const c = m.category || "Menu";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(m);
  }
  const sections: Section[] = [...byCat.entries()].map(([cat, its]) => ({
    cat,
    hero: its.find((m) => m.photo_url)?.photo_url,
    items: its.map((m) => ({ name: m.name, price: m.price ?? null, description: m.description || "", photo_url: m.photo_url, bestseller: m.bestseller })),
  }));
  return {
    name: settings?.name || "Menu",
    logo: bi.brand?.logo_url,
    accent: /^#[0-9a-f]{6}$/i.test(bi.brand?.primary || "") ? bi.brand.primary : "#e11d2a",
    tagline: bi.tagline || "",
    phone: bi.phone || "",
    currency: settings?.payments?.currency || "EGP",
    sections,
  };
}

export default function MenuDesign() {
  const [data, setData] = useState<MenuData | null>(null);
  const [template, setTemplate] = useState("bold");
  const [publishing, setPublishing] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);  // currently published pdf_url
  const [msg, setMsg] = useState("");
  const renderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.get("/api/menu"), api.get("/api/settings")]).then(([m, s]) => {
      setData(toMenuData(m.data || [], s.data));
      setCurrent(s.data?.menu_config?.pdf_url || null);
      if (s.data?.menu_config?.pdf_template) setTemplate(s.data.menu_config.pdf_template);
    }).catch(() => {});
  }, []);

  async function publish() {
    if (!renderRef.current) return;
    setPublishing(true);
    setMsg("Rendering…");
    try {
      // rasterize the full-size template node, then wrap it into a single-page PDF sized
      // to the image so nothing is cropped — a tall menu becomes a tall scrollable PDF
      const canvas = await html2canvas(renderRef.current, { scale: 2, useCORS: true, backgroundColor: null, logging: false });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const pw = canvas.width, ph = canvas.height;
      const pdf = new jsPDF({ orientation: ph >= pw ? "portrait" : "landscape", unit: "px", format: [pw, ph] });
      pdf.addImage(imgData, "JPEG", 0, 0, pw, ph);
      const blob = pdf.output("blob");

      setMsg("Publishing to WhatsApp…");
      const fd = new FormData();
      fd.append("pdf", blob, "menu.pdf");
      fd.append("template", template);
      const r = await api.post("/api/menu/pdf", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setCurrent(r.data?.pdf_url || null);
      setMsg("Published — the bot now sends this menu.");
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Couldn't publish — try again.");
    } finally {
      setPublishing(false);
    }
  }

  async function revert() {
    if (!confirm("Revert to the auto-generated menu?")) return;
    await api.delete("/api/menu/pdf").catch(() => {});
    setCurrent(null);
    setMsg("Reverted to the auto-generated menu.");
  }

  if (!data) return <Empty text="Loading menu…" />;

  return (
    <div>
      <PageHeader
        title="Menu design"
        subtitle="Pick a design — it's rendered from your live menu and photos, then sent to guests on WhatsApp as a PDF"
        actions={
          <div className="flex items-center gap-2">
            {current && <Btn variant="ghost" onClick={revert}><RotateCcw size={15} /> Revert</Btn>}
            <Btn onClick={publish} disabled={publishing}><Send size={15} /> {publishing ? "Publishing…" : "Publish to WhatsApp"}</Btn>
          </div>
        }
      />

      {msg && <div className="mb-4 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-200">{msg}</div>}
      {current && (
        <div className="mb-4 flex items-center gap-2 text-xs text-emerald-400">
          <Check size={14} /> A designed menu is live.{" "}
          <a href={current} target="_blank" rel="noreferrer" className="underline">View current PDF</a>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* template picker */}
        <div className="no-print flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Designs</div>
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => setTemplate(t.key)}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition ${template === t.key ? "border-transparent" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
              style={template === t.key ? { backgroundColor: "var(--accent)", color: "var(--accent-contrast)" } : undefined}
            >
              {t.label}
            </button>
          ))}
          <p className="mt-1 text-xs text-zinc-500">Photos come from your menu items. Add item photos in Menu for the best look.</p>
        </div>

        {/* live preview — the real template, scaled to fit */}
        <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-100 p-4">
          <div style={{ width: 794, transform: "scale(0.62)", transformOrigin: "top left", marginBottom: -280 }}>
            <MenuTemplate template={template} data={data} />
          </div>
        </div>
      </div>

      {/* offscreen full-size render target for the PDF export */}
      <div style={{ position: "fixed", left: -10000, top: 0 }}>
        <div ref={renderRef}><MenuTemplate template={template} data={data} /></div>
      </div>
    </div>
  );
}
