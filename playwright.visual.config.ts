import { defineConfig, devices } from "@playwright/test";

/**
 * Every page and state a user sees, on desktop, iPhone and iPad, compared with committed baselines:
 * the rendered DOM exactly, and screenshots (`pnpm test:visual`, `--update-snapshots` to accept).
 * Baselines depend on the OS's font rendering, so they're per platform and the suite runs locally.
 */
const STATIC_PORT = 4184;
const APP_PORT = 5219;

export default defineConfig({
  testDir: "tests/visual",
  fullyParallel: true,
  reporter: "list",
  timeout: 90_000,
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // Exactness comes from the DOM snapshots; pixels allow for the antialiasing noise that differs
      // between two renders of the same page (emoji and rounded image corners, mostly in WebKit).
      threshold: 0.1,
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
      caret: "hide",
      stylePath: "tests/visual/stable.css",
    },
  },
  use: {
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone", use: { ...devices["iPhone 14"] } },
    { name: "ipad", use: { ...devices["iPad Pro 11"] } },
  ],
  webServer: [
    {
      command: "node --import tsx tests/support/serve-static.ts",
      url: `http://127.0.0.1:${STATIC_PORT}/mtg-doc/`,
      env: { FIXTURES_FATAL: "1", STATIC_PORT: String(STATIC_PORT), VISUAL: "1" },
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command:
        "node --import tsx scripts/elm.ts --to elm-stuff/builds/test/main.js && node --import tsx tests/support/serve-app.ts",
      url: `http://127.0.0.1:${APP_PORT}/api/config`,
      env: {
        FIXTURES_FATAL: "1",
        ELM_OUTPUT: "elm-stuff/builds/test/main.js",
        PORT: String(APP_PORT),
        HOST: "127.0.0.1",
      },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
