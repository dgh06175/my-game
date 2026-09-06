import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  // CI renders WebGL on the CPU; keep the same gameplay checks with more wall-clock time.
  timeout: process.env.CI ? 180_000 : 60_000,
  expect: { timeout: process.env.CI ? 45_000 : 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5180/my-game/",
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    // Keep layout/input coordinates identical while reducing CPU rasterization.
    deviceScaleFactor: process.env.CI ? 0.5 : 1,
    headless: true,
    launchOptions: {
      args: [
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      grep: /@desktop/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-landscape",
      grep: /@mobile/,
      use: {
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: process.env.CI ? 0.5 : 1,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5180 --strictPort",
    url: "http://127.0.0.1:5180/my-game/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
