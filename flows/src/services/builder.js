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
import { featuresScript, DEFAULT_ALLERGENS } from "./builder-features.js";
import { renderLitePage } from "./builder-lite.js";
import { layoutScript } from "./builder-layout.js";

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

export function signBuildToken({ sessionId, slug, ttlMs = TTL_MS, preview = false }) {
  if (!SECRET) throw new Error("BUILD_TOKEN_SECRET (or ENCRYPTION_KEY) is not set");
  const body = b64u(JSON.stringify({ s: sessionId, r: slug, x: Date.now() + ttlMs, ...(preview ? { p: 1 } : {}) }));
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
    return { sessionId: String(p.s), slug: String(p.r), preview: p.p === 1 };
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

// preview=true is the STAFF view: it shows the whole library so a manager can see
// what is available to offer. Customers only ever get layers this restaurant priced —
// which ingredients belong on their menu is their decision, not ours.
export function builderConfig(config, { preview = false } = {}) {
  const byo = config?.menu_config?.build_your_own || {};
  const prices = byo.layers || {};
  const priced = preview
    ? LAYERS.map((l) => ({ ...l, price: Number(prices[l.key]) || 0, unpriced: !Number.isFinite(Number(prices[l.key])) }))
    : LAYERS.map((l) => ({ ...l, price: Number(prices[l.key]) })).filter(
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

// Better than a blank screen or a thrown error: say what is missing, in the
// restaurant's own colours, in words a manager can act on.
function notConfiguredPage(config, brand, bc) {
  const accent = /^#[0-9a-f]{6}$/i.test(brand.primary || "") ? brand.primary : "#e81b23";
  const esc = (t) => String(t ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(config.name)} — build your own</title><style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#faf8f6;color:#16130f;
       margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border:1px solid #e7e2dc;border-radius:16px;padding:26px;max-width:420px;text-align:center}
  .dot{width:44px;height:44px;border-radius:12px;background:${accent};margin:0 auto 14px}
  h1{font-size:19px;margin:0 0 8px}
  p{color:#6f6862;font-size:14px;line-height:1.6;margin:0 0 6px}
  code{background:#f2efec;border-radius:5px;padding:1px 6px;font-size:12.5px}
</style></head><body><div class="card">
  <div class="dot"></div>
  <h1>Build your own isn't set up yet</h1>
  <p>${esc(config.name)} hasn't priced any buns for the builder, so there's nothing to build on.</p>
  <p>Set prices under <code>Settings → Build your own</code> — an ingredient with no price simply isn't offered.</p>
  <p style="margin-top:12px;font-size:12.5px">${bc.layers.length} ingredient${bc.layers.length === 1 ? "" : "s"} priced so far.</p>
</div></body></html>`;
}

// The stock page is a standalone demo: localStorage login, placeholder webhook,
// demo prices, relative model paths. Serving it means replacing exactly those
// seams — everything else about the 3D scene is left alone.
export function renderBuilderPage(tenant, token, { preview = false, menu = [], lite = false } = {}) {
  const config = tenant.config;
  const bc = builderConfig(config, { preview });
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
      e.default = false;   // exactly one is marked below — never zero
    } else {
      e.modelUrl = `${MODEL_BASE}/${l.file}`;
      e.height = l.height;
    }
    return e;
  });

  // The page picks a starting bun with `CATALOG.find(d => d.default)` and then reads
  // its id. With no bread priced that find returns undefined and the whole builder
  // dies on an unreadable property — so guarantee exactly one default, and refuse to
  // render at all when there is no bread to build on.
  // "your build ≈" compares against the restaurant's OWN menu prices — a real
  // comparison, not a guess about what a custom burger is worth.
  const menuForCompare = (menu || [])
    .filter((m) => m && m.name && Number(m.price) > 0)
    .slice(0, 60)
    .map((m) => ({ name: m.name, price: Number(m.price) }));
  const allergenMap = { ...DEFAULT_ALLERGENS, ...(config.menu_config?.build_your_own?.allergens || {}) };

  const breads = catalog.filter((c) => c.category === "bread");
  if (breads.length) (breads.find((b) => b.id === "bun_plain") || breads[0]).default = true;
  else return notConfiguredPage(config, brand, bc);

  // A phone that cannot run WebGL gets the same menu, prices and submit path without
  // the 3D — losing the order is much worse than losing the spinning burger.
  if (lite) {
    return renderLitePage({
      config, brand, catalog, currency: bc.currency, basePrice: bc.base_price,
      maxPerLayer: bc.max_per_layer,
      submitUrl: `${PUBLIC_BASE}/api/build/${encodeURIComponent(token)}/submit`, token,
    });
  }

  const boot = {
    token,
    submitUrl: `${PUBLIC_BASE}/api/build/${encodeURIComponent(token)}/submit`,
    modelBase: MODEL_BASE,
    currency: bc.currency,
    restaurant: config.name,
    catalog,
    maxPerLayer: bc.max_per_layer,
    basePrice: bc.base_price,   // the page must total what the SERVER will charge
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
  // The scene sits behind a grey studio vignette baked for the dark original. On a
  // light brand that reads as a dirty grey box next to white panels.
  const sceneLight = light ? `<style>
    #scene-container{background:radial-gradient(ellipse at 50% 42%,#ffffff 0%,#f4f1ee 55%,#e9e5e1 100%)}
    .vignette{opacity:.18}
    #scene-container header h1{color:#16130f}
  </style>` : "";

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

  html = html.replace("</head>", `${theme}${sceneLight}\n</head>`);

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
  // No WebGL (old phone, blocked GPU, software renderer) → switch to the lite builder
  // BEFORE the 3D code runs and throws, so the customer can still order.
  try {
    var probe = document.createElement('canvas');
    var gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl && location.search.indexOf('lite=1') === -1) {
      location.replace(location.pathname + (location.search ? location.search + '&' : '?') + 'lite=1');
      return;
    }
  } catch (e) { /* probe failed — carry on and let the banner report anything real */ }
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
  // the sprite was half a scene-unit tall, which reads as enormous next to a bun
  html = html.replace(/const h = 0\.5;/g, "const h = 0.3;");

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
      // A Y-rotation by θ maps a local point to x' = x·cosθ + z·sinθ, z' = −x·sinθ + z·cosθ.
      // To pin a child at world (R, 0, 0) the LOCAL position must be (R·cosθ, 0, R·sinθ).
      // Using sin(−θ) here — which is what this did first — negates the z term and makes
      // the label orbit at DOUBLE speed instead of holding still.
      const ry = group.rotation.y, cs = Math.cos(ry), sn = Math.sin(ry);
      for (const g of allGroups) {
        const sp = g.userData.labelSprite;
        if (!sp) continue;
        const R = (g.userData.labelRadius = g.userData.labelRadius || Math.hypot(sp.position.x, sp.position.z) || 3);
        sp.position.x = R * cs;
        sp.position.z = R * sn;
      }
    }`,
  );

  // ---- reorderable stack -------------------------------------------------
  // The prototype fixed the order by category, so a customer could not put cheese
  // under the patty or pickles on top. Bread stays pinned — a bun in the middle of a
  // burger is not a customisation, it's a broken sandwich.
  html = html.replace(
    '    <div id="panel-scroll"></div>',
    `    <div id="stack-panel"><div class="stack-title">Your stack <em>bottom to top</em></div><div id="stack-list"></div></div>
    <div id="panel-scroll"></div>`,
  );

  html = html.replace("</head>", `<style>
    #stack-panel{padding:10px 14px 4px}
    .stack-title{font-size:10px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px}
    .stack-title em{font-style:normal;opacity:.65;letter-spacing:.4px;text-transform:none}
    .stack-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:8px;font-size:12.5px;color:var(--text-main);background:rgba(var(--brand-red-rgb),.05);margin-bottom:3px}
    .stack-row.pinned{opacity:.55;background:transparent}
    .stack-row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .stack-row button{border:0;background:rgba(var(--brand-red-rgb),.14);color:var(--text-main);width:22px;height:22px;border-radius:6px;font-size:12px;cursor:pointer;line-height:1;font-family:inherit}
    .stack-row button:disabled{opacity:.25;cursor:default}
    #stack-list{max-height:22vh;overflow-y:auto;-webkit-overflow-scrolling:touch}
    @media (max-width: 820px){
      /* the panel now carries a stack list AND 37 ingredients — give it room, and
         make the reorder controls thumb-sized rather than pointer-sized */
      #panel{height:56vh}
      #scene-container{height:44vh}
      #stack-panel{padding:8px 12px 2px}
      #stack-list{max-height:16vh}
      .stack-row{padding:7px 8px;font-size:13.5px}
      .stack-row button{width:34px;height:34px;font-size:14px}
      .stack-title{font-size:11px}
    }
    @media (max-width: 820px) and (orientation: landscape){
      /* a phone on its side has no vertical room to split — go back to side by side */
      #app{flex-direction:row}
      #panel{width:44%;height:100%;order:2}
      #scene-container{height:100%;order:1}
    }
  </style>\n</head>`);

  // an explicit order, when the customer has set one, beats the category default
  html = html.replace(
    `    fillings.sort((a, b) => {
      const ca = STACK_ORDER.indexOf(a.userData.category);`,
    `    fillings.sort((a, b) => {
      const ma = manualOrder.indexOf(a.userData.uid), mb = manualOrder.indexOf(b.userData.uid);
      if (ma !== -1 && mb !== -1) return ma - mb;   // both moved by hand
      if (ma !== -1) return -1;
      if (mb !== -1) return 1;
      const ca = STACK_ORDER.indexOf(a.userData.category);`,
  );

  html = html.replace(
    "  function layoutStack() {",
    `  let manualOrder = [];   // uids in the order the customer arranged them

  function renderStackList(order) {
    const el = document.getElementById('stack-list');
    if (!el) return;
    const movable = order.filter((g) => g.userData.category !== 'bread-top' && g.userData.category !== 'bread-bottom');
    el.innerHTML = '';
    order.slice().reverse().forEach((g) => {
      const ud = g.userData;
      const bread = ud.category === 'bread-top' || ud.category === 'bread-bottom';
      const def = CATALOG.find((d) => d.id === ud.ingredientId);
      const row = document.createElement('div');
      row.className = 'stack-row' + (bread ? ' pinned' : '');
      const name = document.createElement('span');
      name.textContent = (def && def.name) || ud.ingredientId || 'layer';
      row.appendChild(name);
      if (!bread) {
        const i = movable.indexOf(g);
        const up = document.createElement('button'); up.textContent = '\u25B2'; up.title = 'Move up';
        up.disabled = i >= movable.length - 1;
        up.onclick = () => moveLayer(movable, i, 1);
        const dn = document.createElement('button'); dn.textContent = '\u25BC'; dn.title = 'Move down';
        dn.disabled = i <= 0;
        dn.onclick = () => moveLayer(movable, i, -1);
        row.appendChild(up); row.appendChild(dn);
      }
      el.appendChild(row);
    });
  }

  function moveLayer(movable, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= movable.length) return;
    // freeze the CURRENT arrangement into manualOrder first, then swap — otherwise the
    // category default would immediately undo the move
    const uids = movable.map((g) => g.userData.uid);
    const t = uids[i]; uids[i] = uids[j]; uids[j] = t;
    manualOrder = uids;
    layoutStack();
  }

  function layoutStack() {`,
  );

  html = html.replace(
    `    order.forEach(g => {
      const h = g.userData.height;`,
    `    renderStackList(order);

    order.forEach(g => {
      const h = g.userData.height;`,
  );

  // The prototype keeps everything inside one IIFE, so the feature layer has no way
  // in. Publish exactly the handful of things it needs — the selection, the catalog,
  // a redraw, and the totals — rather than making the whole scope global.
  html = html.replace(
    "  initAuth();",
    `  window.__BUILD__ = {
    qty: qty,
    catalog: CATALOG,
    totals: calcTotals,
    rerender: function(){ renderPanel(); syncStackWithState(); },
    render: function(){ try { renderer.render(scene, camera); } catch (e) {} },
    // One tiny offscreen renderer, reused for every ingredient card, so a thumbnail
    // costs a single extra draw of a model the page already knows how to load —
    // no image assets to ship and nothing rendered until a card is actually seen.
    thumbnail: function(id, cb){
      try {
        var def = CATALOG.find(function(d){ return d.id === id; });
        if (!def) return cb(null);
        var url = def.modelUrl || def.bottomModelUrl;
        if (!url) return cb(null);
        if (!window.__thumbRig) {
          var rc = document.createElement('canvas'); rc.width = 300; rc.height = 300;
          var rr = new THREE.WebGLRenderer({ canvas: rc, antialias: true, alpha: true, preserveDrawingBuffer: true });
          rr.setPixelRatio(1);
          var sc = new THREE.Scene();
          sc.add(new THREE.AmbientLight(0xffffff, 1.35));
          var dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(3, 6, 4); sc.add(dl);
          // a single key light left every thumbnail dark on its camera-facing side
          var fill = new THREE.DirectionalLight(0xffffff, 0.8); fill.position.set(-3, 2, 3); sc.add(fill);
          var back = new THREE.DirectionalLight(0xffffff, 0.5); back.position.set(0, -2, -3); sc.add(back);
          var cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
          window.__thumbRig = { rc: rc, rr: rr, sc: sc, cam: cam };
        }
        var rig = window.__thumbRig;
        new THREE.GLTFLoader().load(url, function(g){
          var obj = g.scene;
          var box = new THREE.Box3().setFromObject(obj);
          var size = box.getSize(new THREE.Vector3());
          var ctr = box.getCenter(new THREE.Vector3());
          obj.position.sub(ctr);
          var span = Math.max(size.x, size.y, size.z) || 1;
          var wrap = new THREE.Group(); wrap.add(obj);
          wrap.scale.setScalar(1 / span);
          rig.sc.add(wrap);
          // pull back far enough that the model sits INSIDE the frame with margin —
          // at the old distance a bun filled the card and got clipped
          rig.cam.position.set(1.25, 0.9, 2.15);
          rig.cam.lookAt(0, 0, 0);
          rig.rr.render(rig.sc, rig.cam);
          var data = null;
          try { data = rig.rc.toDataURL('image/png'); } catch (e) {}
          rig.sc.remove(wrap);
          cb(data);
        }, undefined, function(){ cb(null); });
      } catch (e) { cb(null); }
    },
  };

  initAuth();`,
  );

  // doneness, sauce, allergy avoidances and the customer's name for the build ride
  // along with the order so the kitchen sees them on the ticket
  html = html.replace(
    "    const payload = { table: tableId, items, total_price: totals.price, total_calories: totals.calories, timestamp: new Date().toISOString() };",
    `    const extras = (typeof window.__BX_EXTRAS__ === 'function') ? window.__BX_EXTRAS__() : {};
    const payload = { table: tableId, items, total_price: totals.price, extras, timestamp: new Date().toISOString() };`,
  );

  // A WebGL canvas reads back BLANK unless the drawing buffer is preserved — which is
  // why the photo card came out with no burger in it. The cost is a little memory; the
  // alternative is a share card of an empty white box.
  html = html.replace(
    "const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });",
    "const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });",
  );

  // SERIOUS: the page totalled the layers only, while the server also charges
  // base_price. A customer was shown EGP 0 for a bun the kitchen would bill at 60.
  // The page must show exactly what the server will charge.
  html = html.replace("    let price = 0, calories = 0;",
    "    let price = (window.__AHLAN__ && window.__AHLAN__.basePrice) || 0, calories = 0;");

  // the burger filled the frame; pull the camera back so the whole stack fits
  html = html.replace("camera.position.set(0, 0.3, 10);", "camera.position.set(0, 0.4, 14);");

  // floating 3D labels competed with the ingredient cards for attention and ran over
  // the panel — keep them small and out of the way
  html = html.replace("    label.position.set(def.radius + 1.15, 0, 0);", "    label.position.set(def.radius + 2.2, 0, 0);");
  html = html.replace("    label.position.set(breadDef.radius + 1.15, 0, 0);", "    label.position.set(breadDef.radius + 2.2, 0, 0);");

  // the header belonged to the prototype, not to this restaurant
  html = html.replace("<h1>Build Your Sandwich</h1>", `<h1>${config.name} — build your own</h1>`);

  // the stack "settles" once the order is actually accepted
  html = html.replace(
    "      statusEl.textContent = 'Order sent to the kitchen';",
    `      statusEl.textContent = 'Order sent to the kitchen';
      if (typeof window.__BX_CONFIRM__ === 'function') window.__BX_CONFIRM__();`,
  );

  const byoCfg = config.menu_config?.build_your_own || {};
  // "Make it a meal" offers the restaurant's REAL sides and drinks at their real
  // prices — never a made-up combo.
  const sideCats = /^(sides?|extras?|appetizers?|drinks?|beverages?)$/i;
  const sides = (menu || [])
    .filter((m) => m && sideCats.test(String(m.category || "")) && Number(m.price) > 0 && m.available !== false)
    .slice(0, 8)
    .map((m) => ({ name: m.name, price: Number(m.price) }));

  html = html.replace("</body>", `${featuresScript({
    menu: menuForCompare,
    currency: bc.currency,
    allergens: allergenMap,
    protein: byoCfg.protein || {},
    presets: Array.isArray(byoCfg.presets) ? byoCfg.presets.slice(0, 4) : [],
    sides,
    limited: byoCfg.limited || {},
    compare: byoCfg.compare === true,   // off until layer-set diffing replaces price matching
    restaurant: config.name,
  })}\n${layoutScript()}\n</body>`);

  // No calorie data exists for these ingredients and inventing some would be worse
  // than showing none, so the counter is hidden.
  html = html.replace("</head>", "<style>#total-calories{display:none}</style>\n</head>");

  return html;
}
