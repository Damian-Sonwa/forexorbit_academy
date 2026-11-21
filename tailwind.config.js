/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /**
         * Brand orange, anchored on the logo (#FF7012 = 500).
         * 400/500 are fills with ink text (500 + #111111 = 6.8:1) and orange on dark surfaces
         * (400 on #07080C = 8.5:1). 600/700 carry white text and orange text on light surfaces
         * (600 = 4.8:1 on white, 4.5:1 on #FAF8F4).
         */
        primary: {
          50: '#FFF6EE',
          100: '#FFE8D5',
          200: '#FFCDA6',
          300: '#FFAB6B',
          400: '#FF8A33',
          500: '#FF7012',
          600: '#C24E00',
          700: '#A33F00',
          800: '#7C3000',
          900: '#4F2004',
          950: '#2B1102',
        },
        secondary: {
          50: '#F7F7F7',
          100: '#EFEFEF',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#171717',
          700: '#525252',
          800: '#404040',
          900: '#111111',
          950: '#0A0A0A',
        },
        /** Destructive / error accent. Kept separate from brand orange. */
        accent: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#F87171',
          500: '#DC2626',
          600: '#B91C1C',
          700: '#991B1B',
          800: '#7F1D1D',
          900: '#450A0A',
        },
        orange: {
          50: '#FFF6EE',
          100: '#FFE8D5',
          200: '#FFCDA6',
          300: '#FFAB6B',
          400: '#FF8A33',
          500: '#FF7012',
          600: '#C24E00',
          700: '#A33F00',
          800: '#7C3000',
          900: '#4F2004',
          950: '#2B1102',
        },
        gray: {
          50: '#FAF8F4',
          100: '#F3F0EA',
          200: '#E7E2DA',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#666666',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0A0A0A',
        },
        neutral: {
          50: '#FAF8F4',
          100: '#F3F0EA',
          200: '#E7E2DA',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#666666',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0A0A0A',
        },
        /** Header / footer chrome */
        nav: {
          bg: '#171717',
          text: '#FFFFFF',
          muted: '#A3A3A3',
        },
        brand: {
          dark: '#171717',
          darker: '#111111',
          deep: '#1C1C1C',
          bg: '#FAF8F4',
          surface: '#FFFFFF',
        },
        canvas: 'var(--fo-bg)',
        shell: 'var(--fo-shell)',
        surface: {
          1: 'var(--fo-surface-1)',
          2: 'var(--fo-surface-2)',
          3: 'var(--fo-surface-3)',
        },
        line: {
          DEFAULT: 'var(--fo-line)',
          strong: 'var(--fo-line-strong)',
        },
        ink: {
          DEFAULT: 'var(--fo-text)',
          muted: 'var(--fo-text-muted)',
          subtle: 'var(--fo-text-subtle)',
        },
        tint: 'var(--fo-brand-tint)',
        up: 'var(--fo-up)',
        down: 'var(--fo-down)',
        caution: 'var(--fo-warn)',
        'level-basic': {
          DEFAULT: '#FF7012',
          light: '#FFF6EE',
          dark: '#A33F00',
        },
        'level-intermediate': {
          DEFAULT: '#A3A3A3',
          light: '#F7F7F7',
          dark: '#404040',
        },
        'level-advanced': {
          DEFAULT: '#D4D4D4',
          light: '#F0F0F0',
          dark: '#171717',
        },
      },
      /**
       * Orbit Instrument design tokens (styles/globals.css defines the variables per theme).
       * Use these for new UI: bg-surface-1, border-line, text-ink-muted, bg-brand-tint ...
       */
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
      },
      borderRadius: {
        panel: '1.125rem',
      },
      transitionTimingFunction: {
        orbit: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      spacing: {
        18: '4.5rem',
        88: '22rem',
        128: '32rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(23, 23, 23, 0.04)',
        card: '0 1px 2px rgba(23, 23, 23, 0.04), 0 8px 24px rgba(23, 23, 23, 0.04)',
        raised: '0 1px 2px rgba(23, 23, 23, 0.06), 0 12px 32px -12px rgba(23, 23, 23, 0.18)',
        panel: 'var(--fo-shadow-panel)',
        lift: 'var(--fo-shadow-lift)',
        glow: '0 0 0 1px rgba(255, 112, 18, 0.35), 0 8px 28px -10px rgba(255, 112, 18, 0.45)',
        panel: 'var(--fo-shadow-panel)',
        lift: 'var(--fo-shadow-lift)',
        glow: '0 0 0 1px rgba(255, 112, 18, 0.35), 0 8px 28px -10px rgba(255, 112, 18, 0.45)',
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'rise-in': 'riseIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in-fast': 'fadeInFast 0.2s ease-out both',
        'rise-in': 'riseIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in-fast': 'fadeInFast 0.2s ease-out both',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        riseIn: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeInFast: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
