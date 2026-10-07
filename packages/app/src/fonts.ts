import localFont from 'next/font/local';

export const ibmPlexMono = localFont({
  src: [
    {
      path: './font-assets/ibm-plex-mono-latin-300-normal.woff2',
      weight: '300',
    },
    {
      path: './font-assets/ibm-plex-mono-latin-400-normal.woff2',
      weight: '400',
    },
    {
      path: './font-assets/ibm-plex-mono-latin-500-normal.woff2',
      weight: '500',
    },
    {
      path: './font-assets/ibm-plex-mono-latin-600-normal.woff2',
      weight: '600',
    },
    {
      path: './font-assets/ibm-plex-mono-latin-700-normal.woff2',
      weight: '700',
    },
  ],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export const robotoMono = localFont({
  src: './font-assets/roboto-mono-latin-wght-normal.woff2',
  weight: '100 700',
  variable: '--font-roboto-mono',
  display: 'swap',
});

export const inter = localFont({
  src: './font-assets/inter-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

export const roboto = localFont({
  src: './font-assets/roboto-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-roboto',
  display: 'swap',
});
