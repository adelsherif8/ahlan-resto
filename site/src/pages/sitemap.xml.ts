/**
 * The sitemap, built from the real pages. Without this file /sitemap.xml fell
 * through to the homepage HTML with a 200, so Google had no page list.
 * /clone and /preview are internal and stay out.
 */
import type { APIRoute } from 'astro';
import { guides } from '../content/guides';

const pages = import.meta.glob('./{ar,en}/**/*.astro');

export const GET: APIRoute = ({ site }) => {
  const paths = new Set<string>();
  for (const f of Object.keys(pages)) {
    if (f.includes('[')) continue;
    paths.add(f.replace(/^\./, '').replace(/\.astro$/, '').replace(/\/index$/, ''));
  }
  for (const g of guides) paths.add(`/ar/${g.slug}`);
  const urls = [...paths].sort().map((p) => `  <url><loc>${new URL(p, site)}</loc></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
