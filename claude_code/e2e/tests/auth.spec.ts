import { test, expect } from "@playwright/test";
import { fillField, logout } from "./helpers.js";

test.beforeEach(async ({ request, page }) => {
  await logout(request);
  await page.goto("/");
});

test("shows the login screen when unauthenticated", async ({ page }) => {
  await expect(page.getByTestId("auth-view")).toBeVisible();
  await expect(page).toHaveScreenshot("auth.png");
});

test("logs in with an API key", async ({ page }) => {
  await page.getByTestId("auth-view").waitFor();
  await page.getByTestId("auth-tab-apikey").click();
  await fillField(page, "apikey-input", "sk-ant-demo-key");
  await page.getByTestId("apikey-submit").click();
  await expect(page.getByTestId("session-list-view")).toBeVisible();
});

test("logs in with the OAuth paste-code flow", async ({ page }) => {
  await page.getByTestId("auth-view").waitFor();
  await page.getByTestId("auth-tab-oauth").click();
  await page.getByTestId("oauth-start").click();
  await expect(page.getByTestId("oauth-url")).toBeVisible();
  await fillField(page, "oauth-code-input", "test-auth-code");
  await page.getByTestId("oauth-complete").click();
  await expect(page.getByTestId("session-list-view")).toBeVisible();
});
