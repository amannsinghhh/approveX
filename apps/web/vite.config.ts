import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @approvex/shared is CJS resolved through a workspace symlink (outside
  // node_modules), so both the dev prebundler and rollup's commonjs interop
  // must be told about it explicitly.
  optimizeDeps: {
    include: ['@approvex/shared'],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /packages\/shared/],
    },
  },
  server: {
    port: 5173,
    proxy: {
      // In docker compose the api service resolves by name; locally it is localhost.
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
