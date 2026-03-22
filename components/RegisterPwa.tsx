import { useEffect } from 'react';

const SW_PATH = '/service-worker.js';

function isSecureContextForSw(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Registers the service worker on HTTPS or localhost only (browser requirement).
 */
export function RegisterPwa() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!isSecureContextForSw()) {
      if (process.env.NODE_ENV === 'development') {
        console.info(
          '[ForexOrbit PWA] Service workers require HTTPS or localhost; skipping registration.'
        );
      }
      return;
    }

    let cancelled = false;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register(SW_PATH, {
          scope: '/',
        });
        if (cancelled) return;

        if (typeof console !== 'undefined' && console.info) {
          console.info('[ForexOrbit PWA] service worker registered:', SW_PATH, 'scope:', reg.scope);
        }

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available; will take control on next navigation if skipWaiting ran in SW
            }
          });
        });
      } catch (err) {
        console.warn('[ForexOrbit PWA] Service worker registration failed:', err);
      }
    };

    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', () => void register(), { once: true });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
