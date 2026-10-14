import { defineConfig, devices } from '@playwright/test';

// ブラウザを別途配置している環境では CHROMIUM_EXECUTABLE で実行ファイルを指定する
const executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = executablePath ? { launchOptions: { executablePath } } : { channel: 'chromium' as const };

export default defineConfig({
  testDir: './tests',
  // One worker: parallel headless WebGL contexts contend for the GPU, and the
  // frame-time collapse makes game time drift from wall time, flaking timed
  // gameplay phases and screenshot baselines.
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
    // Reuse a dev server that is already running for the canvas inspector;
    // CI always starts a fresh one.
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        // devices['Desktop Chrome'] sets no channel, so Playwright launches the
        // bundled headless shell, which has no GPU backend and falls back to
        // SwiftShader (CPU) — roughly 4x slower raster and meaningless FPS.
        // The full Chromium build renders headless on the real GPU.
        ...browser,
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      // iPhone viewport, DPR and touch on the same GPU-backed Chromium as the
      // inspector. devices['iPhone 13'] alone selects WebKit, which needs its
      // own browser download and renders headless without the GPU. Confirm
      // Safari-specific behavior on a real device.
      name: 'mobile-chrome',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        ...browser,
      },
    },
  ],
});
