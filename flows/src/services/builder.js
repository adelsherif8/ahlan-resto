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
  "https://sxthftiqvaojbdyjizjr.supabase.co/storage/v1/object/public/builder/burger1";

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
// Every layer the 3D scene can render. A layer a restaurant hasn't priced is
// simply not offered — the guest never sees a price we invented.
export const LAYERS = [
  { id: "bread-bun",     key: "bun",     category: "bread",   name: "Sesame bun",    fixed: true },
  { id: "protein-patty", key: "patty",   category: "protein", name: "Beef patty" },
  { id: "cheese-slice",  key: "cheese",  category: "cheese",  name: "Cheese slice" },
  { id: "cheese-melted", key: "melted",  category: "cheese",  name: "Melted cheese" },
  { id: "veg-lettuce",   key: "lettuce", category: "veggie",  name: "Lettuce" },
  { id: "veg-tomato",    key: "tomato",  category: "veggie",  name: "Tomato" },
];

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

  const boot = {
    token,
    submitUrl: `${PUBLIC_BASE}/api/build/${encodeURIComponent(token)}/submit`,
    modelBase: MODEL_BASE,
    currency: bc.currency,
    restaurant: config.name,
    prices: Object.fromEntries(bc.layers.map((l) => [l.id, l.price])),
    offered: bc.layers.map((l) => l.id),
    maxPerLayer: bc.max_per_layer,
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
  // the demo's own prices must not survive into a page that takes money
  html = html.replace(
    "  const STACK_ORDER =",
    `  CATALOG.forEach((d) => { d.price = window.__AHLAN__.prices[d.id] ?? d.price; });
  for (let i = CATALOG.length - 1; i >= 0; i--) {
    if (!window.__AHLAN__.offered.includes(CATALOG[i].id)) CATALOG.splice(i, 1);
  }

  const STACK_ORDER =`,
  );
  return html;
}
