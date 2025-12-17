/**
 * Google Analytics 4 (GA4) Utility
 * Provides functions for tracking page views and custom events
 */

// GA4 Measurement ID from environment variable
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

// Check if GA4 is enabled
export const isGAEnabled = () => {
  return typeof window !== 'undefined' && GA_MEASUREMENT_ID;
};

// Track page view
export const pageview = (url: string) => {
  if (!isGAEnabled() || !window.gtag) return;
  
  window.gtag('config', GA_MEASUREMENT_ID!, {
    page_path: url,
  });
};

// Track custom events
export const event = ({
  action,
  category,
  label,
  value,
}: {
  action: string;
  category: string;
  label?: string;
  value?: number;
}) => {
  if (!isGAEnabled() || !window.gtag) return;
  
  window.gtag('event', action, {
    event_category: category,
    event_label: label,
    value: value,
  });
};

// Extend Window interface for gtag
declare global {
  interface Window {
    gtag: (
      command: 'config' | 'event' | 'js' | 'set',
      targetId: string | Date,
      config?: Record<string, unknown>
    ) => void;
    dataLayer: unknown[];
  }
}

