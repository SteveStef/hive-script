import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Two pages: the game and the function docs. In development, API calls and the live
// colony socket go to the game server (npm run server, port 3001, or SERVER_PORT).
const server = `127.0.0.1:${process.env.SERVER_PORT ?? 3001}`;

export default defineConfig({
  server: {
    proxy: {
      '/api': `http://${server}`,
      '/ws': { target: `ws://${server}`, ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        docs: fileURLToPath(new URL('./docs.html', import.meta.url)),
      },
    },
  },
});
