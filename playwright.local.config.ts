import { defineConfig, devices } from '@playwright/test';
import { readLocalStack } from './e2e/admin-web-local/local-stack';

// Real-backend admin-web specs: the browser talks to this worktree's local Supabase
// stack (never the remote project). The mocked suite stays in playwright.config.ts.
// Needs `supabase start` and, in another terminal:
//   supabase functions serve --no-verify-jwt --env-file supabase/functions/.env
const baseURL = 'http://127.0.0.1:5188';
const stack = readLocalStack();

export default defineConfig({
  testDir: './e2e/admin-web-local',
  testMatch: '**/*.local.e2e.ts',
  workers: 1,
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'admin-web-local-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dashboard --host 127.0.0.1 --port 5188 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: stack.apiUrl,
      VITE_SUPABASE_ANON_KEY: stack.anonKey,
    },
  },
});
