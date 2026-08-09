import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/site';

// Served at /robots.txt by Next's file convention. Before this the path 404'd,
// which crawlers treat as "no restrictions" — the same practical outcome, but it
// left nowhere to point at the sitemap.
//
// `/api/` is the one disallow: the chat endpoint deployed alongside this site
// answers a GET with 405, so it is a 4xx a crawler would otherwise keep trying
// and never content anybody should reach from search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: '/api/',
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
