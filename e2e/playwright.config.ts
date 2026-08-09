import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `E2E_LIVE_AI=1` points the suite at a real Ollama daemon and enables the `@live` tests.
 * Everything else runs with the model disabled, so the default suite is deterministic and CI
 * never needs a 2 GB download to prove the board works.
 */
const liveAi = process.env['E2E_LIVE_AI'] === '1';

const API_PORT = 3101;
const WEB_PORT = 5273;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] !== undefined ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],

  webServer: [
    {
      // `:memory:` gives every run a freshly seeded database with no files to clean up, which
      // is what makes the assertions about specific alerts safe to write.
      command: 'npm run dev --workspace @incident-board/api',
      cwd: repoRoot,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_PATH: ':memory:',
        SEED_ON_BOOT: 'true',
        LOG_LEVEL: 'silent',
        AI_ENABLED: liveAi ? 'true' : 'false',
      },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: `npm run dev --workspace @incident-board/web -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: repoRoot,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
});
