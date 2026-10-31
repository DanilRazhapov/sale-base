/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)', soft: 'var(--brand-soft)',
          tint: 'var(--brand-tint)', line: 'var(--brand-line)', hover: 'var(--brand-hover)',
        },
        action: { DEFAULT: 'var(--action)', hover: 'var(--action-hover)' },
        'on-action': 'var(--on-action)',
        canvas: 'var(--canvas)',
        surface: { DEFAULT: 'var(--surface)', soft: 'var(--surface-soft)', muted: 'var(--surface-muted)' },
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        placeholder: 'var(--placeholder)',
        line: { DEFAULT: 'var(--line)', soft: 'var(--line-soft)', strong: 'var(--line-strong)' },
        danger: {
          DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)', line: 'var(--danger-line)',
          action: 'var(--danger-action)', hover: 'var(--danger-hover)',
        },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)', line: 'var(--success-line)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
        overlay: 'var(--overlay)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
    },
  },
  plugins: [],
};
