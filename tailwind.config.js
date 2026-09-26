/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0a0e17',
          800: '#111827',
          700: '#1e293b',
          600: '#334155',
        },
        accent: {
          blue: '#3b82f6',
          green: '#10b981',
          red: '#ef4444',
          purple: '#8b5cf6',
          amber: '#f59e0b',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
