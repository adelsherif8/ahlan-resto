/**
 * schema.org data for search engines. Prices are the published rate card
 * (branding/pricing.md), the same figures the page shows. No ratings or reviews:
 * we have no customers to quote yet, and inventing them breaks Google's rules too.
 */
import type { SiteContent } from '../content/types';
import { WA_NUMBER_INTL, CONTACT_EMAIL } from './const';

const SITE = 'https://munadim.com';

export const organization = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Munadim',
  alternateName: 'منادم',
  url: SITE,
  logo: `${SITE}/brand/08-favicon.svg`,
  email: CONTACT_EMAIL,
  sameAs: ['https://www.instagram.com/munadim.eg/'],
  contactPoint: { '@type': 'ContactPoint', contactType: 'sales', telephone: `+${WA_NUMBER_INTL}`, areaServed: 'EG', availableLanguage: ['ar', 'en'] },
});

export const software = (t: SiteContent, lang: 'ar' | 'en') => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Munadim',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'WhatsApp',
  url: `${SITE}/${lang}`,
  description: t.meta.description,
  inLanguage: lang,
  areaServed: 'EG',
  offers: t.pricing.plans.map((p) => ({
    '@type': 'Offer',
    name: p.name,
    price: p.monthly.replace(/,/g, ''),
    priceCurrency: 'EGP',
    url: `${SITE}/${lang}#pricing`,
  })),
});

export const faq = (items: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((i) => ({
    '@type': 'Question',
    name: i.q.replace(/[«»"]/g, ''),
    acceptedAnswer: { '@type': 'Answer', text: i.a },
  })),
});
