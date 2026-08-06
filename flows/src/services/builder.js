// Build-your-own sandwich: token, pricing, and the served page.
//
// Two rules shape this file:
//   1. CODE computes the price. The browser sends which layers were stacked, never
//      what they cost — a guest editing JS must not be able to set their own total.
//   2. No invented menu data. Layer prices come from menu_config.build_your_own;
//      with none configured the builder stays OFF rather than charging a made-up price.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_BASE, log } from "../config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, "..", "..", "assets", "builder.html");

// Models are generic geometry shared by every restaurant — one hosted copy.
export const MODEL_BASE =
  process.env.BUILDER_MODEL_BASE ||
  "https://sxthftiqvaojbdyjizjr.supabase.co/storage/v1/object/public/builder/v2";

// ---- token -------------------------------------------------------------
// Signed, self-describing, and short-lived: no table, no migration, and a link
// that leaks later is already dead. Carries WHO and WHICH restaurant, so the
// submit endpoint never has to trust the page for either.
const SECRET = process.env.BUILD_TOKEN_SECRET || process.env.ENCRYPTION_KEY || "";
const b64u = (b) => Buffer.from(b).toString("base64url");
const TTL_MS = 24 * 3600_000;

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url").slice(0, 32);
}

export function signBuildToken({ sessionId, slug, ttlMs = TTL_MS }) {
  if (!SECRET) throw new Error("BUILD_TOKEN_SECRET (or ENCRYPTION_KEY) is not set");
  const body = b64u(JSON.stringify({ s: sessionId, r: slug, x: Date.now() + ttlMs }));
  return `${body}.${sign(body)}`;
}

export function verifyBuildToken(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig || !SECRET) return null;
    // timing-safe: a wrong signature must not be distinguishable by how fast we say no
    const expect = sign(body);
    if (sig.length !== expect.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p?.s || !p?.r || !p?.x || Date.now() > p.x) return null;
    return { sessionId: String(p.s), slug: String(p.r) };
  } catch {
    return null;
  }
}

// ---- config ------------------------------------------------------------
// The real Luci'z layer library, exported from Blender. Each entry's radius and
// height were measured from the model's own bounding box (in metres) and converted
// to scene units, so a slice of cheddar is the size of a slice of cheddar relative
// to the bun instead of a number someone guessed.
//
// A layer a restaurant hasn't priced is simply not offered — a customer never sees
// a price we invented.
const CATALOG = JSON.parse(
  fs.readFileSync(path.join(HERE, "builder-catalog.json"), "utf8"),
);

// Tint used only where a model's own texture doesn't carry the look (procedural
// fallback in the page). Grouped by category rather than invented per ingredient.
const CAT_TINT = { bread: 0xd9a55c, protein: 0x6b3a25, cheese: 0xe0a13a, veggie: 0x4c8a3a, sauce: 0xc2402c };

export const LAYERS = CATALOG.map((c) => ({
  id: c.key,                       // key IS the id now — one name for one thing
  key: c.key,
  category: c.category,
  name: c.name,
  fixed: c.category === "bread",   // exactly one bread, and it wraps the stack
  radius: c.radius,
  height: c.height,
  file: c.file,
  topFile: c.topFile || null,
  topHeight: c.topHeight || null,
  bottomHeight: c.bottomHeight || null,
  color: CAT_TINT[c.category] || 0xcccccc,
}));

export function builderConfig(config) {
  const byo = config?.menu_config?.build_your_own || {};
  const prices = byo.layers || {};
  const priced = LAYERS.map((l) => ({ ...l, price: Number(prices[l.key]) })).filter(
    (l) => Number.isFinite(l.price) && l.price >= 0,
  );
  // A builder with no priced protein isn't a burger builder — treat it as unconfigured.
  const usable = priced.some((l) => l.category === "protein");
  return {
    enabled: byo.enabled !== false && usable,
    base_price: Number(byo.base_price) || 0,
    max_per_layer: Number(byo.max_per_layer) || 3,
    layers: priced,
    currency: config?.payments?.currency || "EGP",
    reason: usable ? null : "menu_config.build_your_own.layers has no priced protein",
  };
}

// ---- pricing (authoritative) -------------------------------------------
// Takes the guest's stack, returns what it actually costs. The only place a
// build's price is ever decided.
export function priceBuild(config, picked) {
  const bc = builderConfig(config);
  const byKey = new Map(bc.layers.map((l) => [l.id, l]));
  const lines = [];
  let total = bc.base_price;

  for (const [id, rawQty] of Object.entries(picked || {})) {
    const layer = byKey.get(id);
    if (!layer) continue;                                  // unknown/unpriced → ignored, never guessed
    const qty = layer.fixed ? 1 : Math.max(0, Math.min(bc.max_per_layer, Math.floor(Number(rawQty) || 0)));
    if (qty <= 0) continue;
    const amount = layer.price * qty;
    total += amount;
    lines.push({ id, name: layer.name, qty, unit_price: layer.price, amount });
  }
  return { lines, total, currency: bc.currency, base_price: bc.base_price };
}

// A build has to read like something a kitchen can make.
export function describeBuild(lines) {
  const parts = lines.filter((l) => l.id !== "bread-bun").map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name));
  return parts.length ? parts.join(", ") : "Plain bun";
}

// ---- page --------------------------------------------------------------
let cached = null;
function pageSource() {
  if (!cached) cached = fs.readFileSync(PAGE, "utf8");
  return cached;
}

const jsonScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

// The stock page is a standalone demo: localStorage login, placeholder webhook,
// demo prices, relative model paths. Serving it means replacing exactly those
// seams — everything else about the 3D scene is left alone.
export function renderBuilderPage(tenant, token) {
  const config = tenant.config;
  const bc = builderConfig(config);
  const brand = config.basic_info?.brand || {};
  let html = pageSource();

  // The page's CATALOG is replaced wholesale rather than patched: it shipped with six
  // demo ingredients at demo prices, and this is a real menu now.
  const catalog = bc.layers.map((l) => {
    const e = {
      id: l.id, category: l.category, name: l.name, price: l.price,
      radius: l.radius, color: l.color,
    };
    if (l.category === "bread") {
      e.bottomModelUrl = `${MODEL_BASE}/${l.file}`;
      e.topModelUrl = l.topFile ? `${MODEL_BASE}/${l.topFile}` : `${MODEL_BASE}/${l.file}`;
      e.bottomHeight = l.bottomHeight || l.height;
      e.topHeight = l.topHeight || l.height;
      e.default = l.key === "bun_plain";
    } else {
      e.modelUrl = `${MODEL_BASE}/${l.file}`;
      e.height = l.height;
    }
    return e;
  });

  const boot = {
    token,
    submitUrl: `${PUBLIC_BASE}/api/build/${encodeURIComponent(token)}/submit`,
    modelBase: MODEL_BASE,
    currency: bc.currency,
    restaurant: config.name,
    catalog,
    maxPerLayer: bc.max_per_layer,
    // labels are drawn onto a canvas texture, so they need a real colour value —
    // the cream the prototype used disappears completely on a light brand
    labelColor: brand.mode === "light" ? "#16130f" : "rgba(242, 230, 200, 0.95)",
  };

  // The prototype is hard-committed to a dark red-black "studio" look. That is one
  // restaurant's identity, not every restaurant's — so the page's own custom
  // properties get redefined from the brand: accent from brand.primary, and a light
  // ground when brand.mode is light (Luci'z is white-on-red, nothing black in it).
  const hex = /^#[0-9a-f]{6}$/i.test(brand.primary || "") ? brand.primary : "#e81b23";
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
  const darken = (h, f = 0.72) =>
    "#" + [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0")).join("");
  const light = brand.mode === "light";
  const theme = `<style id="ahlan-brand">:root{
    --brand-red:${hex}; --brand-red-rgb:${rgb}; --brand-red-dark:${darken(hex)};
    ${light ? `
    --bg-mid:#f2efec; --bg-deep:#faf8f6; --bg-black:#ffffff;
    --panel-grad-1:#ffffff; --panel-grad-2:#f5f2ef;
    --text-main:#16130f; --text-on-accent:#ffffff; --text-muted:#6f6862; --text-dim:#a49c95;
    --status-ok:#0f7a4d; --status-error:#c2410c;` : ""}
  }</style>`;

  const replacements = [
    [/<img id="brand-logo" src="[^"]*"/, `<img id="brand-logo" src="${brand.logo_url || ""}"`],
    // the guest arrived through a signed link — there is nobody to log in
    [
      "  function initAuth() {",
      `  function initAuth() {
    if (window.__AHLAN__) { currentUser = 'guest'; currentRole = 'user'; enterApp(); return; }`,
    ],
    // submit goes to us, not the demo webhook
    [
      /webhookUrl: '[^']*',/,
      "webhookUrl: window.__AHLAN__.submitUrl,",
    ],
    [/currency: 'EGP',/, "currency: window.__AHLAN__.currency,"],
    // models come from storage, not a relative folder that doesn't exist here
    [/'Burger1\//g, "window.__AHLAN__.modelBase + '/"],
  ];

  html = html.replace("</head>", `${theme}\n</head>`);

  for (const [find, put] of replacements) {
    if (typeof find === "string" && !html.includes(find)) log(`builder: seam not found: ${find.slice(0, 40)}`);
    html = html.replace(find, put);
  }

  // prices + which layers are on offer are decided here, never in the page
  // A blank screen is the worst possible failure: it tells the restaurant nothing and
  // tells us nothing. Any script error or model that fails to load now says so on the
  // page instead of leaving an empty canvas.
  const guard = `<script>
(function(){
  function banner(msg){
    var b = document.getElementById('ahlan-err');
    if (!b) {
      b = document.createElement('div'); b.id = 'ahlan-err';
      b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7f1d1d;color:#fff;'
        + 'font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:10px 14px;max-height:42vh;overflow:auto';
      document.body.appendChild(b);
    }
    b.textContent = (b.textContent ? b.textContent + '\\n' : '') + msg;
  }
  window.addEventListener('error', function(e){
    banner('Error: ' + (e.message || 'script failed') + (e.filename ? '  [' + String(e.filename).split('/').pop() + ']' : ''));
  });
  window.addEventListener('unhandledrejection', function(e){
    banner('Error: ' + ((e.reason && e.reason.message) || e.reason || 'promise rejected'));
  });
  // Patch NOW, not on window.load — the page's own script starts fetching models the
  // moment it parses, which is before load fires, so a later patch would miss them.
  if (typeof THREE === 'undefined') { document.addEventListener('DOMContentLoaded', function(){ banner('three.js did not load — check the network/CDN.'); }); return; }
  if (!THREE.GLTFLoader) { document.addEventListener('DOMContentLoaded', function(){ banner('GLTFLoader did not load — 3D cannot start.'); }); return; }
  var origLoad = THREE.GLTFLoader.prototype.load;
  THREE.GLTFLoader.prototype.load = function(url, onLoad, onProg, onErr){
    return origLoad.call(this, url, onLoad, onProg, function(err){
      banner('Model failed: ' + String(url).split('/').pop() + ' — ' + ((err && err.message) || 'load error'));
      if (onErr) onErr(err);
    });
  };
})();
</script>`;

  html = html.replace(
    "<script>\n(function () {",
    `<script>window.__AHLAN__ = ${jsonScript(boot)};</script>\n${guard}\n<script>\n(function () {`,
  );
  // The demo CATALOG is REPLACED, not patched — six invented ingredients at invented
  // prices have no business surviving into a page that takes money.
  html = html.replace(/const CATALOG = \[[\s\S]*?\n  \];/, "const CATALOG = window.__AHLAN__.catalog;");

  // five categories now — sauces are new
  html = html.replace(/const STACK_ORDER = \[[^\]]*\];/,
    "const STACK_ORDER = ['sauce', 'protein', 'cheese', 'veggie'];");
  html = html.replace(/const CATEGORY_LABELS = \{[^}]*\};/,
    "const CATEGORY_LABELS = { bread: 'Bread', protein: 'Protein', cheese: 'Cheese', veggie: 'Veggies', sauce: 'Sauces' };");
  html = html.replace(/const CATEGORY_DISPLAY_ORDER = \[[^\]]*\];/,
    "const CATEGORY_DISPLAY_ORDER = ['bread', 'protein', 'cheese', 'veggie', 'sauce'];");

  // The label colour was burned into the canvas texture as cream — invisible on a
  // light brand. Take it from the brand instead.
  html = html.replace("ctx.fillStyle = 'rgba(242, 230, 200, 0.95)';",
    "ctx.fillStyle = (window.__AHLAN__ && window.__AHLAN__.labelColor) || 'rgba(242, 230, 200, 0.95)';");

  // Labels are children of the rotating stack, so they orbited away from the camera as
  // the burger spun. Sprites already face the camera; what they need is to hold their
  // WORLD-space direction. Counter-rotating each one by the stack's own Y rotation
  // pins them to the same side of the screen no matter how the burger is turned.
  html = html.replace(
    "    dust.rotation.y += 0.0006;",
    `    dust.rotation.y += 0.0006;

    // keep every label on the same side of the screen while the stack rotates
    {
      const ry = group.rotation.y, cs = Math.cos(-ry), sn = Math.sin(-ry);
      for (const g of allGroups) {
        const sp = g.userData.labelSprite;
        if (!sp) continue;
        const R = (g.userData.labelRadius = g.userData.labelRadius || Math.hypot(sp.position.x, sp.position.z) || 3);
        sp.position.x = R * cs;
        sp.position.z = R * sn;
      }
    }`,
  );

  // No calorie data exists for these ingredients and inventing some would be worse
  // than showing none, so the counter is hidden.
  html = html.replace("</head>", "<style>#total-calories{display:none}</style>\n</head>");

  return html;
}
