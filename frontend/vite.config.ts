import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  build: {
    target: 'es2022',
    // MapLibre alone is ~1 MB minified (284 kB gzipped); it gets its own chunk.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        // Vendor code changes rarely, so it caches apart from the app.
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'ui', test: /node_modules[\\/](@base-ui|@floating-ui|@tanstack)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    // Unit tests only: Playwright runs the browser tests in e2e/.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
