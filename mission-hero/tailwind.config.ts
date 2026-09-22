import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface tokens are CSS variables so a child's theme can repaint the
        // whole shell without re-rendering component styles.
        ink: 'rgb(var(--mh-ink) / <alpha-value>)',
        muted: 'rgb(var(--mh-muted) / <alpha-value>)',
        surface: 'rgb(var(--mh-surface) / <alpha-value>)',
        card: 'rgb(var(--mh-card) / <alpha-value>)',
        border: 'rgb(var(--mh-border) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--mh-brand) / <alpha-value>)',
          soft: 'rgb(var(--mh-brand-soft) / <alpha-value>)',
        },
        accent: 'rgb(var(--mh-accent) / <alpha-value>)',
        // These appear as text on white cards, so each clears 4.5:1 there.
        // Status is never carried by colour alone regardless (docs/03).
        xp: '#b45309',
        points: '#6d28d9',
        star: '#dc2626',
        success: '#15803d',
        warn: '#a16207',
      },
      borderRadius: { xl2: '1.25rem', xl3: '1.75rem' },
      fontFamily: { display: ['var(--font-display)', 'system-ui', 'sans-serif'] },
      boxShadow: {
        pop: '0 10px 30px -10px rgb(0 0 0 / 0.25)',
        lift: '0 2px 0 0 rgb(0 0 0 / 0.12)',
      },
      keyframes: {
        'pop-in': {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.65' } },
      },
      animation: {
        'pop-in': 'pop-in 240ms cubic-bezier(0.2,0.8,0.2,1)',
        'pulse-soft': 'pulse-soft 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
