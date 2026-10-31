import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        // Warm charcoal-green surfaces, cream text and a clay-orange accent (shared with the overlay themes).
        ink: { 950: '#0d1210', 900: '#131a17', 800: '#19221e', 700: '#232e29', 600: '#314039', 500: '#4c5c54' },
        slate: { 100: '#f4efe4', 200: '#e3ddd0', 300: '#c9c4b7', 400: '#a7b0a3', 500: '#7f8a82', 600: '#5b675f' },
        accent: { DEFAULT: '#f08a4b', dim: '#b45a22' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
