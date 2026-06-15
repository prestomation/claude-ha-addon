import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { AuthMethod, StatusResponse } from "@addon/shared";
import type { ServerConfig } from "./config.js";

const execFileAsync = promisify(execFile);

interface OAuthFlow {
  flowId: string;
  child: ChildProcessWithoutNullStreams;
  url: string;
}

/**
 * Owns authentication state for Claude Code. Credentials live under DATA_DIR
 * (which is also HOME/CLAUDE_CONFIG_DIR for the agent), so they persist across
 * add-on restarts.
 *
 * In mock mode every operation is simulated so the full UI flow can be tested
 * without contacting Anthropic.
 */
export class AuthManager {
  private readonly cfg: ServerConfig;
  private readonly apiKeyFile: string;
  private readonly credentialsFile: string;
  private oauthFlow: OAuthFlow | null = null;

  constructor(cfg: ServerConfig) {
    this.cfg = cfg;
    mkdirSync(cfg.dataDir, { recursive: true });
    this.apiKeyFile = join(cfg.dataDir, "apikey");
    this.credentialsFile = join(cfg.dataDir, ".credentials.json");
  }

  /** The API key to expose to the spawned agent, if any. */
  getApiKey(): string | undefined {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    if (existsSync(this.apiKeyFile)) return readFileSync(this.apiKeyFile, "utf8").trim() || undefined;
    return undefined;
  }

  private detectMethod(): AuthMethod {
    if (this.getApiKey()) return "apikey";
    if (existsSync(this.credentialsFile)) return "oauth";
    return "none";
  }

  async status(): Promise<StatusResponse> {
    if (this.cfg.mock) {
      const method = this.detectMethod();
      return {
        authenticated: method !== "none",
        method,
        claudeVersion: "mock",
        ready: true,
      };
    }
    const method = this.detectMethod();
    let claudeVersion: string | null = null;
    let ready = false;
    try {
      const { stdout } = await execFileAsync("claude", ["--version"], { timeout: 8000 });
      claudeVersion = stdout.trim();
      ready = true;
    } catch {
      ready = false;
    }
    return { authenticated: method !== "none", method, claudeVersion, ready };
  }

  async loginApiKey(apiKey: string): Promise<void> {
    const key = apiKey.trim();
    if (!key) throw new Error("API key is empty");
    if (this.cfg.mock) {
      writeFileSync(this.apiKeyFile, key, { mode: 0o600 });
      return;
    }
    // Validate the key with a cheap request before persisting.
    await this.validateApiKey(key);
    writeFileSync(this.apiKeyFile, key, { mode: 0o600 });
  }

  private async validateApiKey(key: string): Promise<void> {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) {
      throw new Error(`API key rejected (HTTP ${res.status})`);
    }
  }

  async oauthStart(): Promise<{ url: string; flowId: string }> {
    if (this.cfg.mock) {
      const flowId = randomUUID();
      return {
        flowId,
        url: `https://claude.ai/oauth/authorize?mock=1&flow=${flowId}`,
      };
    }
    // Real flow: `claude setup-token` prints an authorization URL and then waits
    // for the user to paste back a code on stdin.
    this.cancelOAuth();
    const child = spawn("claude", ["setup-token"], {
      env: { ...process.env, HOME: this.cfg.dataDir, CLAUDE_CONFIG_DIR: this.cfg.dataDir },
    });
    const flowId = randomUUID();
    const url = await this.readUrlFromChild(child);
    this.oauthFlow = { flowId, child, url };
    return { url, flowId };
  }

  private readUrlFromChild(child: ChildProcessWithoutNullStreams): Promise<string> {
    return new Promise((resolveUrl, reject) => {
      let buf = "";
      const onData = (d: Buffer) => {
        buf += d.toString();
        const match = buf.match(/https?:\/\/\S+/);
        if (match) {
          child.stdout.off("data", onData);
          child.stderr.off("data", onData);
          resolveUrl(match[0]);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`setup-token exited early (code ${code})`)));
      setTimeout(() => reject(new Error("timed out waiting for authorization URL")), 20000);
    });
  }

  async oauthComplete(flowId: string, code: string): Promise<void> {
    if (this.cfg.mock) {
      if (!code.trim()) throw new Error("Authorization code is empty");
      // Simulate a stored OAuth credential.
      writeFileSync(this.credentialsFile, JSON.stringify({ mock: true, ts: Date.now() }), {
        mode: 0o600,
      });
      return;
    }
    const flow = this.oauthFlow;
    if (!flow || flow.flowId !== flowId) throw new Error("No active OAuth flow");
    await new Promise<void>((resolveDone, reject) => {
      flow.child.on("exit", (exitCode) => {
        this.oauthFlow = null;
        if (exitCode === 0 && existsSync(this.credentialsFile)) resolveDone();
        else reject(new Error(`Authorization failed (exit ${exitCode})`));
      });
      flow.child.stdin.write(code.trim() + "\n");
      flow.child.stdin.end();
      setTimeout(() => reject(new Error("timed out completing authorization")), 20000);
    });
  }

  private cancelOAuth(): void {
    if (this.oauthFlow) {
      try {
        this.oauthFlow.child.kill();
      } catch {
        /* ignore */
      }
      this.oauthFlow = null;
    }
  }

  logout(): void {
    this.cancelOAuth();
    for (const f of [this.apiKeyFile, this.credentialsFile]) {
      if (existsSync(f)) rmSync(f);
    }
  }
}
