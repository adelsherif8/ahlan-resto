/**
 * Site-wide constants. THE single place numbers and names change.
 */

/** Munadim's own WhatsApp — the human CTA number (opens a chat with the team). */
export const WA_NUMBER_DISPLAY = '01009955923';
export const WA_NUMBER_INTL = '201009955923';

/** Prefilled CTA message: «عايز أشوف عرض توضيحي» */
export const WA_LINK = `https://wa.me/${WA_NUMBER_INTL}?text=${encodeURIComponent(
  'عايز أشوف عرض توضيحي',
)}`;

export const CONTACT_EMAIL = 'welcome@munadim.com';

/**
 * The fictional restaurant in the demo chat. Vetted against Google/Instagram/
 * Facebook 2026-08-14 — no real place carries this name. NEVER a real client.
 * It keeps its own fictional number; the Munadim number never appears in the chat.
 */
export const DEMO_RESTAURANT_AR = 'برجر تحت البيت';
export const DEMO_RESTAURANT_EN = 'Burger Taht El-Beit';

/** «عرض توضيحي» — every demo surface carries this label. */
export const DEMO_LABEL_AR = 'عرض توضيحي';
export const DEMO_LABEL_EN = 'Demo';
