import type { MetadataRoute } from 'next';

/**
 * Crawlers.
 *
 * The administrator's area, the sign-in page, the design deliverable and search results are all
 * excluded. The design directory is the approved reference and is not the site: leaving it
 * crawlable would put the prototype's example content into search results alongside the real
 * archive.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/signin', '/search', '/design/', '/api/'],
      },
    ],
    sitemap: 'https://ozikoro.com/sitemap.xml',
    host: 'https://ozikoro.com',
  };
}
