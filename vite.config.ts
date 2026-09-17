import { defineConfig } from 'vite';

// base './' so the build works under https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node' },
} as any);
