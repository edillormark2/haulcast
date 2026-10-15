import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { HtmlTagDescriptor, Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadHints()],
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

/**
 * Tells the browser about files it would otherwise find late. The lazily
 * loaded map (with MapLibre and its stylesheet) starts downloading with the
 * page, at low priority so the panel's code still arrives first, and the UI
 * font's Latin subset loads before the stylesheet that names it is parsed.
 */
function preloadHints(): Plugin {
  let base = '/'
  return {
    name: 'haulcast:preload-hints',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        if (!bundle) return []
        const files = Object.values(bundle)
        const tags: HtmlTagDescriptor[] = []
        const link = (attrs: Record<string, string | boolean>) =>
          tags.push({ tag: 'link', attrs, injectTo: 'head' })

        const map = files.find(
          (file) => file.type === 'chunk' && file.facadeModuleId?.endsWith('/TripMap.tsx'),
        )
        if (map?.type === 'chunk') {
          const chunkNames = [map.fileName, ...map.imports]
          const styleNames = files.flatMap((file) =>
            file.type === 'chunk' && chunkNames.includes(file.fileName)
              ? [...(file.viteMetadata?.importedCss ?? [])]
              : [],
          )
          // Same attributes as Vite's own loader uses, so the browser reuses these.
          const hint = { crossorigin: true, fetchpriority: 'low' }
          for (const name of chunkNames.filter((name) => !html.includes(name))) {
            link({ rel: 'modulepreload', href: base + name, ...hint })
          }
          for (const name of styleNames.filter((name) => !html.includes(name))) {
            link({ rel: 'preload', as: 'style', href: base + name, ...hint })
          }
        }

        const font = files.find((file) =>
          /overpass-latin-wght-normal-[\w-]+\.woff2$/.test(file.fileName),
        )
        if (font) {
          link({
            rel: 'preload',
            as: 'font',
            type: 'font/woff2',
            href: base + font.fileName,
            crossorigin: true,
          })
        }
        return tags
      },
    },
  }
}
