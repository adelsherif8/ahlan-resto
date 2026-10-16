// The demo gate: who gets in, for how long, and what they're told.
// Pure logic only — no network, no DB.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_HOURS, demoOn, leadState, hoursLeft,
  addLead, parseLeadBlob, notRegistered, welcomeBack, expired, isTester, normId, isHandle,
} from "../src/services/demolead.js";

const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString();

// a Supabase-shaped stub: one row, remembered
function fakeDb(row = null) {
  const store = { row };
  const api = {
    from() { return api; },
    select() { return api; },
    eq() { return api; },
    maybeSingle: async () => ({ data: store.row, error: null }),
    insert(patch) { store.row = { id: "x", ...patch }; return api; },
    update(patch) { store.row = { ...store.row, ...patch }; return api; },
  };
  return { api, store };
}

test("demo mode is off unless the restaurant row says true", () => {
  assert.equal(demoOn({ ai: { demo_mode: true } }), true);
  assert.equal(demoOn({ ai: { demo_mode: "true" } }), false); // a string must not open the gate
  assert.equal(demoOn({ ai: {} }), false);
  assert.equal(demoOn({}), false);
  assert.equal(demoOn(null), false);
});

test("three states: never submitted, inside the window, past it", () => {
  assert.equal(leadState(null), "new");
  assert.equal(leadState({ prompted_at: hours(-1) }), "new");          // link sent ≠ started
  assert.equal(leadState({ submitted_at: hours(-1), expires_at: hours(23) }), "active");
  assert.equal(leadState({ submitted_at: hours(-30), expires_at: hours(-6) }), "expired");
});

test("the clock starts when we let them in, not when they first knock", async () => {
  const { api, store } = fakeDb({ id: "x", phone_number: "+201111111111", prompted_at: hours(-5) });
  assert.equal(leadState(store.row), "new");
  const lead = await addLead(api, "+201111111111", { name: "Martin", business_name: "Burger Lab", business_type: "Burgers / fast casual" });
  assert.equal(leadState(lead), "active");
  const span = (new Date(lead.expires_at) - new Date(lead.started_at)) / 3600_000;
  assert.equal(Math.round(span), DEMO_HOURS);
  assert.ok(hoursLeft(lead) <= DEMO_HOURS && hoursLeft(lead) >= DEMO_HOURS - 1);
});

test("stored fields are trimmed, capped, and never undefined", async () => {
  const { api } = fakeDb();
  const lead = await addLead(api, "+201222222222", { name: "  Adel  ", note: "x".repeat(500), website: "", city: null });
  assert.equal(lead.name, "Adel");
  assert.equal(lead.note.length, 300);
  assert.equal(lead.website, null);
  assert.equal(lead.city, null);
  assert.equal(lead.phone_number, "+201222222222");
});

test("hoursLeft never goes negative", () => {
  assert.equal(hoursLeft({ expires_at: hours(-50) }), 0);
  assert.equal(hoursLeft(null), 0);
});

test("every line the bot can send exists in all three languages", () => {
  for (const lang of ["en", "ar", "fr"]) {
    assert.ok(notRegistered(lang, "wa.me/201515066123").includes("201515066123"), `notRegistered ${lang}`);
    assert.ok(welcomeBack(lang, { name: "Martin", expires_at: hours(20) }).length > 100, `welcomeBack ${lang}`);
    assert.ok(expired(lang, "munadim.com").includes("munadim.com"), `expired ${lang}`);
  }
  // the three really are different texts, not one language three times
  assert.notEqual(notRegistered("en"), notRegistered("ar"));
  assert.notEqual(notRegistered("ar"), notRegistered("fr"));
  // Arabic copy is Arabic script; Franco copy is not
  assert.match(welcomeBack("ar", { expires_at: hours(20) }), /[\u0600-\u06FF]/);
  assert.doesNotMatch(welcomeBack("fr", { expires_at: hours(20) }), /[\u0600-\u06FF]/);
  assert.doesNotMatch(welcomeBack("en", { expires_at: hours(20) }), /[\u0600-\u06FF]/);
  // and it tells them what to actually try
  assert.match(welcomeBack("en", { expires_at: hours(20) }), /split the check/i);
});

test("a missing name doesn't leave a dangling greeting", () => {
  assert.doesNotMatch(welcomeBack("en", { expires_at: hours(10) }), /Thanks\s{2,}/);
});

test("a pasted WhatsApp reply becomes a lead row", () => {
  const f = parseLeadBlob(`NAME: Martin Fahmy
PHONE NUMBER: 0111 311 1026
RESTAURANT NAME: Burger Lab
TYPE: burgers
SITE OR INSTAGRAM: instagram.com/burgerlab
CITY: Maadi
BRANCHES: 2
ANYTHING YOU WANT IT TO HANDLE: delivery + splitting bills`);
  assert.equal(f.name, "Martin Fahmy");
  assert.equal(f.phone, "+201113111026");       // normalised on the way in
  assert.equal(f.business_name, "Burger Lab");
  assert.equal(f.business_type, "burgers");
  assert.equal(f.website, "instagram.com/burgerlab");
  assert.equal(f.city, "Maadi");
  assert.equal(f.branches, "2");
  assert.match(f.note, /splitting bills/);
});

test("parsing survives how people actually type", () => {
  const f = parseLeadBlob(`*Name*: Sara
whatsapp : +20 100 123 4567
Restaurant - skipped
BUSINESS NAME: Cafe Noon
city: zamalek
branches: -
We open at 7am every day`);
  assert.equal(f.name, "Sara");
  assert.equal(f.phone, "+201001234567");       // label alias + spaces
  assert.equal(f.business_name, "Cafe Noon");
  assert.equal(f.city, "zamalek");              // lowercase label
  assert.equal(f.branches, undefined);          // "-" is not an answer
  assert.match(f.note, /7am/);                  // a volunteered line is kept, not dropped
});

test("an empty or junk paste yields no phone, so the tool can refuse it", () => {
  assert.equal(parseLeadBlob("").phone, undefined);
  assert.equal(parseLeadBlob("sure sounds good!").phone, undefined);
  assert.match(parseLeadBlob("sure sounds good!").note, /sounds good/);
});

test("our own numbers skip the gate, however the number is written", () => {
  const config = { ai: { demo_mode: true, demo_testers: ["+20 111 311 1026"] } };
  for (const written of ["+201113111026", "201113111026", "01113111026", "+20 111 311 1026", "0111 311 1026"]) {
    assert.equal(isTester(config, written), true, `${written} was not recognised`);
  }
  assert.equal(isTester(config, "+201113111027"), false);
  assert.equal(isTester({ ai: {} }, "+201113111026"), false);
  assert.equal(normId("01113111026"), "+201113111026");
  assert.equal(normId(""), "");
});

test("a trailing * lets a whole test block through", () => {
  const config = { ai: { demo_testers: ["+2015570*"] } };
  assert.equal(isTester(config, "+2015570001"), true);
  assert.equal(isTester(config, "+2015570006"), true);
  assert.equal(isTester(config, "+201557100099"), false); // 20155710 \u2260 2015570
  assert.equal(isTester(config, "+201113111026"), false);
});

test("a * block never swallows a real guest's number", () => {
  // the whole point of the length guard: harness numbers carry 9 digits after +20,
  // a real Egyptian mobile carries 10. Widening a prefix for the fixtures must never
  // hand a stranger on the demo line a free bot.
  const config = { ai: { demo_testers: ["+201555*", "+2015*"] } };
  assert.equal(isTester(config, "+20155501001"), true);   // fixture, 9 digits
  assert.equal(isTester(config, "+201555010012"), false); // real mobile, 10 digits
  assert.equal(isTester(config, "+201515066123"), false); // Munadim's own live number
  assert.equal(isTester(config, "+201234509876"), false); // the gate probe's stranger
});

test("the labels from OUR OWN ask-message parse, brackets and all", () => {
  // people paste the template back verbatim, bracketed hints included — if these
  // labels stop matching, every lead lands as an unparsed blob
  const f = parseLeadBlob(`NAME: Martin
PHONE NUMBER (the one you'll WhatsApp from): 0111 311 1026
RESTAURANT NAME: Burger Lab
TYPE (burgers / coffee / Egyptian / pizza / cloud kitchen / other): burgers
SITE OR INSTAGRAM: instagram.com/burgerlab
CITY: Maadi
BRANCHES: 2
ANYTHING YOU WANT IT TO HANDLE: delivery + splitting bills`);
  assert.deepEqual(f, {
    note: "delivery + splitting bills",
    name: "Martin",
    phone: "+201113111026",
    business_name: "Burger Lab",
    business_type: "burgers",
    website: "instagram.com/burgerlab",
    city: "Maadi",
    branches: "2",
  });
});

test("a WhatsApp username is a legal id, kept verbatim", () => {
  assert.equal(normId("@MartinMomtaz"), "@martinmomtaz");
  assert.equal(normId(" @martin momtaz "), "@martinmomtaz");
  assert.equal(isHandle("@martinmomtaz"), true);
  assert.equal(isHandle("+201113111026"), false);
  assert.equal(normId("hello"), "");            // neither — the tool refuses it
  // and a username in the paste is picked up as the id
  assert.equal(parseLeadBlob("NAME: Martin\nUSERNAME: @martinmomtaz").phone, "@martinmomtaz");
  assert.equal(parseLeadBlob("WhatsApp username: @seadoor").phone, "@seadoor");
  // testers can be usernames too
  assert.equal(isTester({ ai: { demo_testers: ["@martinmomtaz"] } }, "@MartinMomtaz"), true);
});
