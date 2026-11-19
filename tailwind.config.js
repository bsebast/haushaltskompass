/** Farben kommen als CSS-Variablen aus src/tokens.css (generiert aus replica/design/tokens.json). */
const role = (n) => `rgb(var(--c-${n}) / <alpha-value>)`;
const roles = ['bg','surface','surface-2','border','border-input','text','text-muted','accent','accent-soft','on-accent','income','expense','danger','warning','success'];
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: Object.fromEntries(roles.map((r) => [r, role(r)])),
      borderRadius: { sm: '6px', md: '10px', lg: '14px' },
      boxShadow: { card: '0 1px 2px rgba(29,35,33,.06), 0 2px 6px rgba(29,35,33,.06)' },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
