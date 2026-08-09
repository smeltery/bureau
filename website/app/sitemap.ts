import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/site';

// Served at /sitemap.xml by Next's file convention.
//
// One entry, because the marketing site is one page: everything else on it is a
// section of that page reached by an anchor, and anchors are not separate URLs.
// It is written as a list anyway so adding a route means adding a line here
// rather than discovering months later that the new page was never submitted.
//
// No `lastModified`. It is optional, and the honest value — when the page's
// content last changed — is not something a build knows; stamping build time
// instead would tell a crawler the page changed on every unrelated deploy,
// which is how a sitemap teaches crawlers to stop believing it.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_ORIGIN}/`,
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
