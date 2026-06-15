import { test, expect } from "@playwright/test";
import { logout, loginViaApi, startSession, sendPrompt } from "./helpers.js";

test.beforeEach(async ({ request, page }) => {
  await logout(request);
  await loginViaApi(request);
  await page.goto("/");
});

test("shows the working-directory picker", async ({ page }) => {
  await expect(page.getByTestId("session-list-view")).toBeVisible();
  await expect(page.getByTestId("dir-option").first()).toBeVisible();
  await expect(page).toHaveScreenshot("session-list.png");
});

test("auto mode: streams a reply with a tool call", async ({ page }) => {
  await startSession(page);
  await sendPrompt(page, "update my Home Assistant dashboard");

  const toolCall = page.locator('[data-testid="transcript-item"][data-kind="tool_call"]');
  await expect(toolCall).toBeVisible();
  const reply = page.locator('[data-testid="transcript-item"][data-kind="text"][data-role="assistant"]');
  await expect(reply).toContainText("Done", { timeout: 10_000 });
  // Turn finished: the composer offers send again (not stop).
  await expect(page.getByTestId("composer-send")).toBeVisible();
  await expect(page).toHaveScreenshot("session-auto.png");
});

test("plan mode: shows a plan checklist", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("mode-plan").click();
  await sendPrompt(page, "refactor my automations");

  const plan = page.locator('[data-testid="transcript-item"][data-kind="plan"]');
  await expect(plan).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("mode-plan")).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveScreenshot("session-plan.png");
});

test("model can be switched", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("model-select").selectOption("claude-opus-4-8");
  await expect(page.getByTestId("model-select")).toHaveValue("claude-opus-4-8");
});

test("permission request can be approved", async ({ page }) => {
  await startSession(page);
  await sendPrompt(page, "please ask permission to deploy");

  await expect(page.getByTestId("permission-sheet")).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveScreenshot("permission-sheet.png");

  await page.getByTestId("permission-allow").click();
  const reply = page.locator('[data-testid="transcript-item"][data-kind="text"][data-role="assistant"]');
  await expect(reply).toContainText("Permission granted", { timeout: 10_000 });
});
