import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/production",
  timeout: 90000,
  workers: 3,
  use: { baseURL: "http://127.0.0.1:5183", headless: true },
  webServer: {
    command: "GOOSNAV_APP_DATA=$(mktemp -d) GOOSNAV_NO_BROWSER=1 GOOSNAV_PORT_PREFERENCE=5183 python3 app/src/goosnav_font/start.py",
    url: "http://127.0.0.1:5183",
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", channel: process.env.CI ? undefined : "chrome" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
