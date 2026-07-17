import type { ReactNode } from 'react';

export const metadata = {
  title: 'LovesCleaning',
  description: "Operator's book",
};

// Phone-first (NFR1): a single viewport-locked shell, minimal client JS.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
