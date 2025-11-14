import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Chidiya Ud',
  description: 'Real-time reflex game'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
