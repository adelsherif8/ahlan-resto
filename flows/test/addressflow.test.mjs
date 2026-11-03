import { test } from "node:test";
import assert from "node:assert/strict";
import { addressFlowJson, flowReplyToText, flowReplyAddress, flowToken, parseFlowToken, flowName, flowCta } from "../src/services/addressflow.js";
import { parseAddress } from "../src/services/address.js";
import { parseEnvelope } from "../src/services/whatsapp.js";

const STREETS_EN = ["Street 9", "12 Road 233", "Nasr St.", "El Nasr Road", "90th Street", "Zahraa El Maadi 5"];
const STREETS_AR = ["شارع ٩", "شارع التسعين", "شارع النصر", "طريق النصر", "زهراء المعادي ٥", "عمارات العبور"];
const AREAS_EN = ["Maadi", "New Cairo", "Tagamoa", "Rehab", "Madinaty", "Heliopolis"];
const AREAS_AR = ["المعادي", "التجمع الخامس", "الرحاب", "مدينتي", "مصر الجديدة", "القاهرة الجديدة"];
const LANDMARKS_EN = ["Metro Market", "the mosque", "Point 90 mall", "CIB bank", "Costa Coffee", "the school"];
const LANDMARKS_AR = ["مترو ماركت", "الجامع", "بوينت ٩٠", "بنك CIB", "كوستا", "المدرسة"];

// deterministic pseudo-random so a failure reproduces
let seed = 7;
const rnd = (n) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n); };
const pick = (arr) => arr[rnd(arr.length)];

function randomPayload(lang) {
  const ar = lang === "ar";
  return {
    street: pick(ar ? STREETS_AR : STREETS_EN),
    area: pick(ar ? AREAS_AR : AREAS_EN),
    building: String(1 + rnd(60)),
    floor: rnd(3) === 0 ? "" : String(rnd(12)),
    apartment: rnd(3) === 0 ? "" : String(1 + rnd(40)),
    landmark: rnd(2) === 0 ? "" : pick(ar ? LANDMARKS_AR : LANDMARKS_EN),
  };
}

test("flow completion round-trips through parseAddress — EN and AR, 50 payloads each", () => {
  for (const lang of ["en", "ar"]) {
    for (let i = 0; i < 50; i++) {
      const p = randomPayload(lang);
      const text = flowReplyToText(p, lang);
      const parsed = parseAddress(text);
      assert.ok(parsed, `parsed nothing from "${text}"`);
      assert.equal(parsed.street, p.street, `street from "${text}"`);
      assert.equal(parsed.area, p.area, `area from "${text}"`);
      assert.equal(parsed.building, p.building, `building from "${text}"`);
      assert.equal(parsed.floor || "", p.floor, `floor from "${text}"`);
      assert.equal(parsed.apartment || "", p.apartment, `apartment from "${text}"`);
      assert.equal(parsed.landmark || "", p.landmark, `landmark from "${text}"`);
    }
  }
});

test("flowReplyToText: blanks are skipped, separators inside a field cannot break the labels", () => {
  assert.equal(flowReplyToText({ street: "Street 9", area: "Maadi", building: "14" }), "Street 9, building 14, Maadi");
  assert.equal(flowReplyToText({ street: "شارع ٩", area: "المعادي", building: "١٤", floor: "٣" }, "ar"), "شارع ٩, عمارة ١٤, الدور ٣, المعادي");
  const p = parseAddress(flowReplyToText({ street: "Road 9, villa", area: "Maadi, Cairo", building: "14B", landmark: "near, the club" }));
  assert.equal(p.building, "14B");
  assert.equal(p.area, "Maadi Cairo");
  assert.equal(p.street, "Road 9 villa");
  assert.equal(flowReplyToText({}), "");
  assert.equal(flowReplyAddress({ street: "", area: "", building: "" }), null);
});

test("Flow JSON: version 7.3, one terminal screen, labels within Meta's caps, complete action echoes every field", () => {
  for (const lang of ["en", "ar"]) {
    const j = addressFlowJson(lang);
    assert.equal(j.version, "7.3");
    assert.equal(j.screens.length, 1);
    const s = j.screens[0];
    assert.equal(s.id, "ADDRESS");
    assert.equal(s.terminal, true);
    const form = s.layout.children[0];
    assert.equal(form.type, "Form");
    const fields = form.children.filter((c) => c.type !== "Footer");
    assert.deepEqual(fields.map((f) => f.name), ["street", "area", "building", "floor", "apartment", "landmark"]);
    for (const f of fields) assert.ok(f.label.length <= 30, `${lang} label too long: ${f.label}`);
    assert.deepEqual(fields.filter((f) => f.required).map((f) => f.name), ["street", "area", "building"]);
    const footer = form.children.at(-1);
    assert.equal(footer.type, "Footer");
    assert.equal(footer["on-click-action"].name, "complete");
    assert.deepEqual(Object.keys(footer["on-click-action"].payload), ["street", "area", "building", "floor", "apartment", "landmark"]);
    assert.ok(flowCta(lang).length <= 30 && !/[\u{1F300}-\u{1FAFF}]/u.test(flowCta(lang)), "CTA cap / emoji");
    JSON.stringify(j); // serialisable
  }
  assert.equal(flowName("munadim", "ar"), "munadim-address-ar-v1");
  assert.equal(flowName("munadim", "franco"), "munadim-address-en-v1");
});

test("flow_token: round-trips restaurant + session, rejects garbage", () => {
  const t = flowToken("r-123", "+201555000001");
  const p = parseFlowToken(t);
  assert.equal(p.restaurantId, "r-123");
  assert.equal(p.sessionId, "+201555000001");
  assert.ok(Date.now() - p.at < 5000);
  assert.equal(parseFlowToken(flowToken(null, "+2")).restaurantId, null);
  assert.equal(parseFlowToken("nope"), null);
  assert.equal(parseFlowToken(""), null);
});

test("parseEnvelope: an nfm_reply completion is an interactive event carrying the parsed form", () => {
  const body = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "PNID1" },
      contacts: [{ wa_id: "201555000001", profile: { name: "Sara" } }],
      messages: [{
        from: "201555000001", id: "wamid.1", timestamp: "1", type: "interactive",
        context: { from: "15550000000", id: "wamid.flowmsg" },
        interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ flow_token: "addr|r1|+201555000001|1", street: "Street 9", area: "Maadi", building: "14", floor: "3", apartment: "", landmark: "" }) } },
      }],
    } }] }],
  };
  const { events } = parseEnvelope(body);
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.type, "interactive");
  assert.equal(e.interactive.kind, "nfm_reply");
  assert.equal(e.interactive.flow.street, "Street 9");
  assert.equal(e.interactive.flow.flow_token, "addr|r1|+201555000001|1");
  assert.equal(e.interactive.id, null);
  // a broken response_json never throws the whole webhook away
  body.entry[0].changes[0].value.messages[0].interactive.nfm_reply.response_json = "{not json";
  const again = parseEnvelope(body).events[0];
  assert.equal(again.interactive.kind, "nfm_reply");
  assert.deepEqual(again.interactive.flow, {});
});
