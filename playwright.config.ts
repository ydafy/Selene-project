import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5187';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // CI retries a failed test twice and reports a pass after a retry as flaky,
  // so an intermittent failure (#169) does not turn the run red.
  retries: process.env.CI ? 2 : 0,
  // On CI, the HTML report is the artifact the workflow uploads on failure,
  // and the github reporter annotates failures and flaky tests on the run.
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : 'list',
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
      VITE_HCAPTCHA_SITE_KEY: '',
    },
  },
});
