import './globals.css';
import './theme-dark.css';
import './theme-light.css';
import { THEME_SCRIPT } from '@/lib/theme';
import ErrorReporter from '@/components/ErrorReporter';
import ArrowScroll from '@/components/ArrowScroll';

export const metadata = {
  title: 'ACE — Project Control',
  description: 'Project management for the whole team',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport = {
  themeColor: '#0F1F3D',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ErrorReporter />
        <ArrowScroll />
        {children}
      </body>
    </html>
  );
}
