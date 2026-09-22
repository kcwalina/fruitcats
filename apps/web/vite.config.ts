import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Card art lives in the repo's art/ folder and is served as-is: /sb1/<id>.webp (illustrations)
// and /cards/sb1/<id>.webp (finished cards).
export default defineConfig({
  base: './',
  publicDir: fileURLToPath(new URL('../../art', import.meta.url)),
  server: { port: 5173, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
});
