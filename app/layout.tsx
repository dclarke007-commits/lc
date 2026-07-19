import type { ReactNode } from 'react';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import './globals.css';

export const metadata = {
  title: 'LovesCleaning',
  description: "Operator's book",
};

// Display face carries the brand personality; body face stays quiet and legible.
// Exposed as CSS variables so globals.css owns all type decisions.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

// Phone-first (NFR1): a single viewport-locked shell, minimal client JS.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
