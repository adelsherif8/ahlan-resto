// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://munadim.com',
  output: 'static',
  trailingSlash: 'never',
  // ar.html, not ar/index.html: Cloudflare Pages redirects /ar to /ar/ for a folder,
  // which would make every canonical and sitemap URL (all slash-less) a redirect.
  build: { format: 'file' },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
