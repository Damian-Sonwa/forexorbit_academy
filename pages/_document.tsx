/**
 * Custom Document
 * Adds DOCTYPE and proper HTML structure
 */

import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" href="/favicon.ico" />
        <meta name="theme-color" content="#003153" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

