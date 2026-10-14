import { defineConfig, devices } from '@playwright/test'

const PORT = 4174
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // CI runners have no GPU: SwiftShader gives MapLibre a software WebGL 2.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  // The production build, served by `vite preview`. The test stubs every
  // request the page makes, so no API server is needed.
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
  },
})
