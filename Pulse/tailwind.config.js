/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F5F7FA',
        surface: '#FFFFFF',
        sunken: '#FAFBFD',
        line: '#E7EAF0',
        line2: '#D5DAE3',
        ink: '#0C1526',
        body: '#3E4A5E',
        muted: '#6B7A90',
        faint: '#94A1B4',

        brand: {
          DEFAULT: '#2F6BFF',
          ink: '#1B4FD8',
          soft: '#EEF3FF',
          line: '#C9D9FF',
        },
        pos: { DEFAULT: '#12924F', soft: '#E8F7EE', line: '#BEE7CD' },
        neg: { DEFAULT: '#DC4849', soft: '#FDECEC', line: '#F6C9C9' },
        warn: { DEFAULT: '#C8871B', soft: '#FDF3E1', line: '#F0DCB4' },

        facebook: '#1877F2',
        instagram: '#E1306C',
        youtube: '#FF0033',
        linkedin: '#0A66C2',
        pinterest: '#E60023',
        searchConsole: '#2FA84F',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', '16px'],
        kpi: ['28px', '34px'],
      },
      borderRadius: {
        card: '14px',
        xl2: '18px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(12,21,38,.04), 0 1px 3px rgba(12,21,38,.06)',
        lift: '0 4px 12px rgba(12,21,38,.07), 0 1px 3px rgba(12,21,38,.05)',
        pop: '0 12px 32px rgba(12,21,38,.14), 0 2px 6px rgba(12,21,38,.06)',
        inset: 'inset 0 0 0 1px rgba(12,21,38,.05)',
      },
      keyframes: {
        rise: { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'none' } },
        fade: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulsedot: { '0%,100%': { opacity: 1 }, '50%': { opacity: .45 } },
      },
      animation: {
        rise: 'rise .35s cubic-bezier(.16,1,.3,1) both',
        fade: 'fade .25s ease-out both',
        pulsedot: 'pulsedot 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
