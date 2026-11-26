/** Farben kommen als CSS-Variablen aus src/tokens.css (generiert aus replica/design/tokens.json). */
const role = (n) => `rgb(var(--c-${n}) / <alpha-value>)`;
const roles = ['bg','surface','surface-2','border','border-input','text','text-muted','accent','accent-soft','on-accent','income','expense','danger','warning','success','planned','planned-bg','s1','s2','s3','s4','s5','s6','s7','s8'];
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: Object.fromEntries(roles.map((r) => [r, role(r)])),
      borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '18px' },
      boxShadow: { card: 'var(--shadow-card)', pop: 'var(--shadow-pop)' },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
