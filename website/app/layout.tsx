import type { Metadata } from 'next';
import '@/styles/globals.css';

const title = 'bureau — Your agent office for Claude Code';
const description =
  'Friction going from 1 Claude Code to 4+? Bureau is your local-first agent office for orchestrating, monitoring, and collaborating with multiple agents.';

export const metadata: Metadata = {
  metadataBase: new URL('https://bureau.dotbrains.io'),
  title,
  description,
  openGraph: {
    title,
    description,
    url: 'https://bureau.dotbrains.io',
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
      </head>
      <body>{children}</body>
    </html>
  );
}
