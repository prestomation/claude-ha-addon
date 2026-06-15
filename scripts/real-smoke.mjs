/**
 * Optional smoke test against the REAL Claude Code ACP adapter.
 *
 * Starts the server in real (non-mock) mode and drives one tiny prompt turn
 * over the WebSocket bridge, asserting that an assistant reply streams back.
 * Requires Claude Code + @zed-industries/claude-code-acp installed and a valid
 * CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY) in the environment.
 *
 * Exits 0 on success, non-zero on failure.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const PORT = 8299;
const base = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "claude-real-"));

const server = spawn("node", ["server/dist/index.js"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: dataDir,
    HOME: dataDir,
    CLAUDE_CONFIG_DIR: dataDir,
    LOG_LEVEL: "info",
  },
  stdio: ["ignore", "inherit", "inherit"],
});

const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  server.kill();
  process.exit(1);
};

const timer = setTimeout(() => fail("timed out after 90s"), 90_000);

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${base}/api/status`);
      if (res.ok) {
        const status = await res.json();
        console.log("status:", JSON.stringify(status));
        if (!status.ready) fail("server reports Claude Code is not installed/ready");
        return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail("server did not start");
}

await waitForServer();

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let sessionId = null;
let assistantText = "";

ws.on("open", () => ws.send(JSON.stringify({ type: "new_session", cwd: process.cwd() })));
ws.on("error", (err) => fail(`ws error: ${err.message}`));
ws.on("message", (data) => {
  const m = JSON.parse(data.toString());
  switch (m.type) {
    case "session_created":
      sessionId = m.session.id;
      console.log("session:", sessionId, "models:", m.session.models.map((x) => x.id).join(","));
      ws.send(JSON.stringify({ type: "prompt", sessionId, text: "Reply with exactly one word: pong" }));
      break;
    case "transcript_append":
    case "transcript_update":
      if (m.item?.kind === "text" && m.item.role === "assistant") assistantText += m.item.text ?? "";
      if (m.patch?.text) assistantText = m.patch.text;
      break;
    case "error":
      fail(`server error: ${m.message}`);
      break;
    case "turn_done":
      clearTimeout(timer);
      console.log("turn_done:", m.stopReason, "| assistant said:", JSON.stringify(assistantText.trim()));
      server.kill();
      if (assistantText.trim().length === 0) fail("no assistant text received");
      console.log("SMOKE OK");
      process.exit(0);
  }
});
