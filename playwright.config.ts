import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5187';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'admin-web-chromium',
      testMatch: 'admin-web/**/*.e2e.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dashboard --host 127.0.0.1 --port 5187 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://payments-e2e.invalid',
      VITE_SUPABASE_ANON_KEY: 'e2e-public-placeholder-not-a-credential',
    },
  },
});
