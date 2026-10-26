import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Two pages: the game and the function docs.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        docs: fileURLToPath(new URL('./docs.html', import.meta.url)),
      },
    },
  },
});
