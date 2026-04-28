import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0b1220',
        panel: '#111a2e',
        border: '#24324a',
        text: '#e2e8f0',
        muted: '#8aa0bd',
        accent: '#38bdf8',
        danger: '#ef4444'
      },
      boxShadow: {
        glass: '0 12px 40px rgba(2, 8, 20, 0.32)'
      },
      backgroundImage: {
        'app-radial': 'radial-gradient(circle at top, #121d34 0%, #0b1220 45%)'
      }
    }
  },
  plugins: []
};

export default config;
