import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const PORT = 8199;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  snapshotDir: "./screenshots",
  // Stable, flat snapshot paths that are committed: screenshots/<project>/<name>.png
  snapshotPathTemplate: "{snapshotDir}/{projectName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02,
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "sh -c 'rm -rf /tmp/e2e-data && node server/dist/index.js'",
    cwd: repoRoot,
    url: `${baseURL}/api/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      ACP_MOCK: "1",
      DATA_DIR: "/tmp/e2e-data",
      PORT: String(PORT),
      WEB_DIST: resolve(repoRoot, "web", "dist"),
      ACP_AGENT_CMD: `node ${resolve(repoRoot, "mock-acp", "dist", "index.js")}`,
      ACP_WORKING_DIRS: "/tmp/work|Workspace,/tmp/share|Share",
    },
  },
});
