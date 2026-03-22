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
        /** Brand — ForexOrbit palette */
        primary: {
          50: '#e9f4f4',
          100: '#cce8e9',
          200: '#9fd2d5',
          300: '#6fbcbf',
          400: '#449ea3',
          500: '#197278',
          600: '#15666a',
          700: '#125458',
          800: '#0f4346',
          900: '#0b3234',
          950: '#071f21',
        },
        secondary: {
          50: '#f6eded',
          100: '#e8d5d2',
          200: '#d4aeaa',
          300: '#bf8781',
          400: '#a86057',
          500: '#772E25',
          600: '#652720',
          700: '#53201a',
          800: '#411914',
          900: '#2f120e',
          950: '#1d0b08',
        },
        accent: {
          50: '#fceeed',
          100: '#f7d5d1',
          200: '#eeb1a9',
          300: '#e58d81',
          400: '#dc6959',
          500: '#C44536',
          600: '#a3392d',
          700: '#822d24',
          800: '#61221b',
          900: '#401612',
        },
        /** Navbar / footer / dark chrome (#283D3B) */
        nav: {
          bg: '#283D3B',
          text: '#EDDDD4',
          muted: '#b8cfc9',
        },
        /** Page & surfaces */
        brand: {
          dark: '#283D3B',
          darker: '#1e2d2b',
          deep: '#152220',
          bg: '#EDDDD4',
          surface: '#ffffff',
        },
        /** Course difficulty — aligned with brand */
        'level-basic': {
          DEFAULT: '#197278',
          light: '#e9f4f4',
          dark: '#125458',
        },
        'level-intermediate': {
          DEFAULT: '#772E25',
          light: '#f6eded',
          dark: '#53201a',
        },
        'level-advanced': {
          DEFAULT: '#283D3B',
          light: '#EDDDD4',
          dark: '#1e2d2b',
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
        soft: '0 2px 15px -3px rgba(40, 61, 59, 0.08), 0 10px 20px -2px rgba(40, 61, 59, 0.05)',
        card: '0 4px 14px -4px rgba(40, 61, 59, 0.12), 0 2px 6px -2px rgba(40, 61, 59, 0.08)',
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
