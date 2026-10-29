/**
 * Custom Document
 * Adds DOCTYPE and proper HTML structure
 */

import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en" className="dark">
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" type="image/png" href="/brand/favicon-64.png" />
        <link rel="manifest" href="/manifest.json" />
        {/*
          Fonts load from here. The @import in globals.css came after other rules in the built
          CSS, so browsers ignored it and Inter/Poppins never loaded. display=swap keeps text
          visible while they download; only the weights the UI uses are requested.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap"
        />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="theme-color" content="#07080c" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var light=localStorage.getItem('theme')==='light';var root=document.documentElement;root.classList.toggle('dark',!light);var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',light?'#faf8f4':'#07080c');}catch(e){}})();`,
          }}
        />
        <meta name="application-name" content="ForexOrbit Academy" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="ForexOrbit" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="format-detection" content="telephone=no" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

