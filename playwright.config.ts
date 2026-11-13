import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5187';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // A committed test.only fails CI instead of silently skipping the rest (#345).
  forbidOnly: !!process.env.CI,
  // CI retries a failed test twice and reports a pass after a retry as flaky,
  // so an intermittent failure (#169) does not turn the run red.
  retries: process.env.CI ? 2 : 0,
  // On CI, the HTML report is the artifact the workflow uploads on failure or
  // on a flaky run, and the github reporter annotates both on the run. The JSON
  // report tells the workflow whether the run had flaky tests (stats.flaky).
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'test-results/results.json' }],
      ]
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
      VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-public-placeholder-not-a-credential',
      VITE_HCAPTCHA_SITE_KEY: '',
    },
  },
});
