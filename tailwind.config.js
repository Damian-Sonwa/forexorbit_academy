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
         * Orange / white / black system.
         * 400 (#F28C28) is the brand accent. It fails WCAG with white text (2.45:1),
         * so filled buttons and small text use 600 (#B85C0E, 4.59:1 with white)
         * and 500 (#D96F12) for borders, focus, and progress (3.37:1 on white).
         */
        primary: {
          50: '#FFF8F1',
          100: '#FFEDD8',
          200: '#FDD8B0',
          300: '#F8B56A',
          400: '#F28C28',
          500: '#D96F12',
          600: '#B85C0E',
          700: '#A34E09',
          800: '#7C3C08',
          900: '#4A2506',
          950: '#2A1503',
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
          50: '#FFF8F1',
          100: '#FFEDD8',
          200: '#FDD8B0',
          300: '#F8B56A',
          400: '#F28C28',
          500: '#D96F12',
          600: '#B85C0E',
          700: '#A34E09',
          800: '#7C3C08',
          900: '#4A2506',
          950: '#2A1503',
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
        'level-basic': {
          DEFAULT: '#F28C28',
          light: '#FFF8F1',
          dark: '#9A4E0C',
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
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'system-ui', 'sans-serif'],
      },
      spacing: {
        18: '4.5rem',
        88: '22rem',
        128: '32rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(23, 23, 23, 0.04)',
        card: '0 1px 2px rgba(23, 23, 23, 0.04), 0 8px 24px rgba(23, 23, 23, 0.04)',
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
