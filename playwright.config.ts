import { defineConfig, devices } from "@playwright/test";

const STATIC_PORT = 4174;
const APP_PORT = 5199;
const LLM_APP_PORT = 5198;
const record = process.env.FIXTURES === "record" || process.env.FIXTURES === "missing";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: record ? 240_000 : 60_000,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone", use: { ...devices["iPhone 14"] }, testMatch: /static\.spec\.ts/ },
    { name: "ipad", use: { ...devices["iPad Pro 11"] }, testMatch: /static\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "node --import tsx test/support/serve-static.ts",
      url: `http://127.0.0.1:${STATIC_PORT}/mtg-doc/`,
      env: { STATIC_PORT: String(STATIC_PORT) },
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The real dev server, with outbound HTTP replayed from fixtures and no LLM.
      command:
        "node --import tsx scripts/elm.ts && node --import tsx --import ./test/support/env.ts server/index.ts",
      url: `http://127.0.0.1:${APP_PORT}/api/config`,
      env: { PORT: String(APP_PORT), HOST: "127.0.0.1", REFRESH_DELAY_MS: "1500" },
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The same, with a stand-in model that streams its replies.
      command:
        "node --import tsx scripts/elm.ts && node --import tsx test/support/serve-llm-app.ts",
      url: `http://127.0.0.1:${LLM_APP_PORT}/api/config`,
      env: { PORT: String(LLM_APP_PORT), HOST: "127.0.0.1", REFRESH_DELAY_MS: "1500" },
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
