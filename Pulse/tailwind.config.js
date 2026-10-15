/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0D0F14',
        surface: '#151822',
        surface2: '#1B1F2A',
        surface3: '#232838',
        hairline: '#262B38',
        hairline2: '#31384A',
        amber: {
          DEFAULT: '#F2A93B',
          dim: '#8A6420',
        },
        text: {
          DEFAULT: '#F4F5F7',
          muted: '#8A8F9C',
          faint: '#5B606E',
        },
        fb: '#2E7CF6',
        ig1: '#F0587B',
        ig2: '#B93BD1',
        yt: '#FF3B4E',
        good: '#3ED598',
        bad: '#FF7A59',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      backgroundImage: {
        'ig-gradient': 'linear-gradient(135deg, #F0587B 0%, #B93BD1 100%)',
        'grain': "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.035) 1px, transparent 0)",
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 20px 40px -20px rgba(0,0,0,0.6)',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.35 },
        },
        rise: {
          '0%': { opacity: 0, transform: 'translateY(6px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        sweep: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        blink: 'blink 2s ease-in-out infinite',
        rise: 'rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        sweep: 'sweep 4s linear infinite',
      },
    },
  },
  plugins: [],
}
