/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: 'var(--bg-primary)',
          'bg-2': 'var(--bg-secondary)',
          'bg-3': 'var(--bg-tertiary)',
          border: 'var(--border-color)',
          text: 'var(--text-primary)',
          'text-2': 'var(--text-secondary)',
          'text-3': 'var(--text-muted)',
          accent: 'var(--accent)',
          green: 'var(--status-green)',
          orange: 'var(--status-orange)',
          red: 'var(--status-red)',
          purple: 'var(--status-purple)',
        }
      },
      fontFamily: {
        mono: ['Cascadia Code', 'Consolas', 'Monaco', 'monospace'],
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px var(--accent), 0 0 10px var(--accent)' },
          '100%': { boxShadow: '0 0 10px var(--accent), 0 0 20px var(--accent)' },
        }
      }
    },
  },
  plugins: [],
}
