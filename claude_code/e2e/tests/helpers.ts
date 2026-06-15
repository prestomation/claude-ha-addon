import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Fill a field by test id, piercing Material Web shadow DOM when the editable
 * <input>/<textarea> is nested (md-filled-text-field), or filling the host
 * directly when it is a native input.
 */
export async function fillField(page: Page, testId: string, value: string): Promise<void> {
  const host = page.getByTestId(testId);
  const inner = host.locator("input, textarea");
  if ((await inner.count()) > 0) {
    await inner.first().fill(value);
  } else {
    await host.fill(value);
  }
}

/** Reset the server to a logged-out state between tests. */
export async function logout(request: APIRequestContext): Promise<void> {
  await request.post("/api/auth/logout");
}

/** Authenticate via the API (bypassing the UI) so session tests start ready. */
export async function loginViaApi(request: APIRequestContext): Promise<void> {
  await request.post("/api/auth/apikey", { data: { apiKey: "sk-e2e-test" } });
}

/** From the session list, open a session on the first working directory. */
export async function startSession(page: Page): Promise<void> {
  await page.getByTestId("session-list-view").waitFor();
  await page.getByTestId("dir-option").first().click();
  await page.getByTestId("start-session").click();
  await page.getByTestId("session-view").waitFor();
}

/** Send a prompt from the composer. */
export async function sendPrompt(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
}
