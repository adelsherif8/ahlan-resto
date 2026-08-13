/**
 * Cloudflare Pages Function — handles `/` only (decision 5):
 * cookie choice wins, then Accept-Language, Arabic default.
 * Every other path is served statically.
 */
export async function onRequest({ request }) {
  const cookie = request.headers.get('Cookie') || '';
  const saved = cookie.match(/(?:^|;\s*)munadim-lang=(ar|en)/)?.[1];

  let lang = saved;
  if (!lang) {
    const accept = (request.headers.get('Accept-Language') || '').toLowerCase();
    // Arabic default — only an explicitly English-preferring device gets /en
    lang = accept.startsWith('en') ? 'en' : 'ar';
  }

  const url = new URL(request.url);
  url.pathname = `/${lang}`;
  return Response.redirect(url.toString(), 302);
}
