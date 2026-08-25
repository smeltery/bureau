import type { Metadata } from 'next';
import '@/styles/globals.css';
import { SITE_DESCRIPTION, SITE_GITHUB_URL, SITE_ORIGIN, SITE_TITLE } from '@/site';

const title = SITE_TITLE;
const description = SITE_DESCRIPTION;
const canonicalUrl = `${SITE_ORIGIN}/`;
const softwareApplicationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'bureau',
  description,
  url: canonicalUrl,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Linux, macOS',
  isAccessibleForFree: true,
  sameAs: [SITE_GITHUB_URL],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title,
  description,
  // Names which address is the original. Without it, any other hostname
  // resolving to this deployment (a www variant, a Vercel preview domain) is a
  // page with identical content and no stated preference, and a crawler has to
  // guess which one to index — it may guess right, but it should not have to.
  // Resolved against metadataBase, so it stays correct if the origin moves.
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title,
    description,
    url: SITE_ORIGIN,
    siteName: 'bureau',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: title,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og-image.png'],
  },
  icons: {
    icon: [
      {
        url: '/favicon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: [
      {
        url: '/favicon.svg',
        type: 'image/svg+xml',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
