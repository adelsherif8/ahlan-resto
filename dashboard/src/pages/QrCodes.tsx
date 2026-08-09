import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Printer, Download } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input } from "../components/ui";

// The QR always points at click-to-chat WhatsApp with an optional prefilled message,
// so a scan opens a chat with the order intent already typed.
function waLink(number: string, prefill: string) {
  const digits = String(number || "").replace(/\D/g, "");
  const q = prefill ? `?text=${encodeURIComponent(prefill)}` : "";
  return digits ? `https://wa.me/${digits}${q}` : "";
}

const VARIANTS: { key: string; label: string }[] = [
  { key: "tent", label: "Table tent" },
  { key: "poster", label: "Poster" },
  { key: "sticker", label: "Sticker" },
  { key: "minimal", label: "Minimal" },
];

export default function QrCodes() {
  const [brand, setBrand] = useState<any>({});
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [prefill, setPrefill] = useState("Hi! I'd like to order 🍔");
  const [headline, setHeadline] = useState("Scan to order");
  const [variant, setVariant] = useState("tent");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // pull the restaurant's number, logo and colour
  useEffect(() => {
    api.get("/api/settings").then((r) => {
      const b = r.data?.basic_info?.brand || {};
      setBrand(b);
      setName(r.data?.name || "");
      setNumber(r.data?.pos?.wa_number || String(r.data?.basic_info?.phone || "").replace(/\D/g, "") || "");
    }).catch(() => {});
  }, []);

  const url = waLink(number, prefill);
  const accent = /^#[0-9a-f]{6}$/i.test(brand.primary || "") ? brand.primary : "#e11d2a";

  // regenerate the QR (error-correction H so the centre logo doesn't break it), then
  // draw the logo in a white rounded pad in the middle
  useEffect(() => {
    if (!url) { setQrDataUrl(""); return; }
    const canvas = canvasRef.current || document.createElement("canvas");
    QRCode.toCanvas(canvas, url, { errorCorrectionLevel: "H", margin: 1, width: 660, color: { dark: "#111111", light: "#ffffff" } })
      .then(() => {
        const ctx = canvas.getContext("2d");
        if (!ctx) { setQrDataUrl(canvas.toDataURL("image/png")); return; }
        const finish = () => setQrDataUrl(canvas.toDataURL("image/png"));
        if (!brand.logo_url) return finish();
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const s = canvas.width * 0.22;               // logo box ~22% of the QR
          const x = (canvas.width - s) / 2;
          const pad = s * 0.12;
          // white rounded pad behind the logo so it reads cleanly over the modules
          ctx.fillStyle = "#fff";
          const r = 16;
          ctx.beginPath();
          ctx.roundRect(x - pad, x - pad, s + pad * 2, s + pad * 2, r);
          ctx.fill();
          ctx.drawImage(img, x, x, s, s);
          finish();
        };
        img.onerror = finish;                          // logo blocked by CORS → plain QR, still valid
        img.src = brand.logo_url;
      })
      .catch(() => setQrDataUrl(""));
  }, [url, brand.logo_url]);

  function downloadPng() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.download = `${(name || "whatsapp").replace(/[^\w]+/g, "-").toLowerCase()}-qr.png`;
    a.href = qrDataUrl;
    a.click();
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp QR codes"
        subtitle="Printable codes that open a chat with your bot — for tables, receipts, the door, flyers"
        actions={
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={downloadPng}><Download size={15} /> PNG</Btn>
            <Btn onClick={() => window.print()}><Printer size={15} /> Print</Btn>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* controls */}
        <div className="no-print flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <Field label="WhatsApp number">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="201515066123" />
            </Field>
            <Field label="Pre-filled message (optional)">
              <Input value={prefill} onChange={(e) => setPrefill(e.target.value)} placeholder="Hi! I'd like to order" />
            </Field>
            <Field label="Headline">
              <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={28} />
            </Field>
            {!number && <p className="text-xs text-amber-400">Set a WhatsApp number (Settings → POS → WhatsApp number) or type one above.</p>}
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Style</div>
            <div className="grid grid-cols-2 gap-2">
              {VARIANTS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setVariant(v.key)}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${variant === v.key ? "border-transparent" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
                  style={variant === v.key ? { backgroundColor: "var(--accent)", color: "var(--accent-contrast)" } : undefined}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-zinc-500">Print gives you a clean page (this panel is hidden). PNG downloads just the code with your logo.</p>
          </Card>
        </div>

        {/* preview / print area */}
        <div className="flex justify-center">
          <div id="qr-print" className="w-full max-w-md">
            {!qrDataUrl ? (
              <Card className="flex h-80 items-center justify-center p-6 text-sm text-zinc-500">Enter a number to generate the code.</Card>
            ) : (
              <VariantCard variant={variant} qr={qrDataUrl} accent={accent} name={name} logo={brand.logo_url} headline={headline} />
            )}
          </div>
        </div>
      </div>

      {/* offscreen canvas the QR is drawn on */}
      <canvas ref={canvasRef} className="hidden" />

      {/* print: show ONLY the code card, full page, on white */}
      <style>{`
        @media print {
          body { background: #fff !important; }
          .no-print, aside, header { display: none !important; }
          #qr-print { max-width: none !important; width: 100% !important; }
          #qr-print .qr-card { box-shadow: none !important; border: none !important; }
          @page { margin: 14mm; }
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function VariantCard({ variant, qr, accent, name, logo, headline }: { variant: string; qr: string; accent: string; name: string; logo?: string; headline: string }) {
  const contrast = "#ffffff";

  if (variant === "sticker") {
    return (
      <div className="qr-card mx-auto flex w-64 flex-col items-center gap-2 rounded-3xl bg-white p-5 text-center shadow-lg" style={{ border: `3px solid ${accent}` }}>
        <div className="text-sm font-extrabold" style={{ color: accent }}>{headline.toUpperCase()}</div>
        <img src={qr} alt="QR" className="w-40" />
        <div className="text-xs font-semibold text-zinc-700">📲 Order on WhatsApp</div>
        {name && <div className="text-[11px] text-zinc-400">{name}</div>}
      </div>
    );
  }

  if (variant === "minimal") {
    return (
      <div className="qr-card mx-auto flex w-72 flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-lg">
        <img src={qr} alt="QR" className="w-56" />
        <div className="text-sm font-bold text-zinc-800">{headline}</div>
        <div className="text-xs text-zinc-500">Scan with your camera · Order on WhatsApp</div>
      </div>
    );
  }

  if (variant === "poster") {
    return (
      <div className="qr-card mx-auto flex w-full max-w-md flex-col items-center overflow-hidden rounded-2xl bg-white text-center shadow-lg">
        <div className="flex w-full flex-col items-center gap-2 px-6 py-7" style={{ background: accent, color: contrast }}>
          {logo && <img src={logo} alt="" className="mb-1 h-14 w-14 rounded-xl bg-white object-contain p-1" />}
          <div className="text-3xl font-black leading-tight">{headline}</div>
          {name && <div className="text-sm opacity-90">{name}</div>}
        </div>
        <div className="flex flex-col items-center gap-3 px-6 py-8">
          <img src={qr} alt="QR" className="w-64" />
          <div className="text-base font-bold text-zinc-800">📲 Order on WhatsApp</div>
          <div className="text-sm text-zinc-500">Point your phone camera at the code — no app needed</div>
        </div>
      </div>
    );
  }

  // table tent (default)
  return (
    <div className="qr-card mx-auto flex w-full max-w-sm flex-col items-center overflow-hidden rounded-2xl bg-white text-center shadow-lg">
      <div className="flex w-full items-center justify-center gap-2 px-5 py-4" style={{ background: accent, color: contrast }}>
        {logo && <img src={logo} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" />}
        <span className="text-lg font-extrabold">{name || "Order with us"}</span>
      </div>
      <div className="flex flex-col items-center gap-3 px-6 py-7">
        <div className="text-2xl font-black" style={{ color: accent }}>{headline}</div>
        <img src={qr} alt="QR" className="w-52" />
        <div className="text-sm font-bold text-zinc-800">📲 Order on WhatsApp</div>
        <div className="text-xs text-zinc-500">Scan with your camera — we'll take it from there</div>
      </div>
    </div>
  );
}
