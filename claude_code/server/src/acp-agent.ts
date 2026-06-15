import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { resolve as resolvePath, dirname, basename, sep } from "node:path";
import { EventEmitter } from "node:events";
import {
  ACP,
  ACP_PROTOCOL_VERSION,
  JsonRpcPeer,
  RpcError,
  type NewSessionResult,
  type PromptResult,
  type RequestPermissionParams,
  type RequestPermissionResult,
  type SessionMode,
  type SessionUpdateNotification,
} from "@addon/shared";
import type { ServerConfig } from "./config.js";

/**
 * Manages a single ACP agent subprocess (the real `claude-code-acp` adapter in
 * production, or `mock-acp` in tests) and exposes a typed client API. The
 * server is the ACP *client*.
 *
 * Events:
 *   "update"     -> SessionUpdateNotification (from session/update)
 *   "permission" -> { params, resolve } (from session/request_permission)
 *   "exit"       -> the subprocess exited
 */
export class AcpAgent extends EventEmitter {
  private readonly cfg: ServerConfig;
  private readonly getApiKey: () => string | undefined;
  private child: ChildProcessWithoutNullStreams | null = null;
  private peer: JsonRpcPeer | null = null;
  private initialized: Promise<void> | null = null;

  constructor(cfg: ServerConfig, getApiKey: () => string | undefined) {
    super();
    this.cfg = cfg;
    this.getApiKey = getApiKey;
  }

  /** Lazily spawn + initialize the agent. Safe to call repeatedly. */
  async ensureReady(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = this.start();
    try {
      await this.initialized;
    } catch (err) {
      this.initialized = null;
      throw err;
    }
  }

  private async start(): Promise<void> {
    const [cmd, ...args] = splitCommand(this.cfg.agentCmd);
    const apiKey = this.getApiKey();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: this.cfg.dataDir,
      CLAUDE_CONFIG_DIR: this.cfg.dataDir,
    };
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;

    const child = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const peer = new JsonRpcPeer({
      send: (line) => child.stdin.write(line),
      onError: (err) => this.emit("agent-error", err),
    });
    this.peer = peer;

    child.stdout.on("data", (chunk: string) => peer.receive(chunk));
    child.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
    child.on("exit", (code) => {
      this.emit("exit", code);
      this.peer?.close("agent exited");
      this.peer = null;
      this.child = null;
      this.initialized = null;
    });
    child.on("error", (err) => this.emit("agent-error", err));

    // Agent -> client notifications & requests.
    peer.onNotification(ACP.SESSION_UPDATE, (params) => {
      this.emit("update", params as SessionUpdateNotification);
    });
    peer.onRequest(ACP.SESSION_REQUEST_PERMISSION, (params) => {
      return new Promise<RequestPermissionResult>((resolve) => {
        this.emit("permission", { params: params as RequestPermissionParams, resolve });
      });
    });
    peer.onRequest(ACP.FS_READ_TEXT_FILE, async (params) => {
      const { path } = params as { path: string };
      const safe = await this.assertPathAllowed(path);
      const content = await readFile(safe, "utf8");
      return { content };
    });
    peer.onRequest(ACP.FS_WRITE_TEXT_FILE, async (params) => {
      const { path, content } = params as { path: string; content: string };
      const safe = await this.assertPathAllowed(path);
      await writeFile(safe, content, "utf8");
      return {};
    });

    await peer.request(ACP.INITIALIZE, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
  }

  private requirePeer(): JsonRpcPeer {
    if (!this.peer) throw new Error("ACP agent is not running");
    return this.peer;
  }

  /**
   * Guard the client-side filesystem handlers: the agent may only read/write
   * within the configured working directories, never the add-on's /data volume
   * (which holds credentials). Symlinks are resolved so they cannot escape.
   * Returns the absolute path to use, or throws an RpcError.
   */
  private async assertPathAllowed(p: string): Promise<string> {
    if (!p || typeof p !== "string") {
      throw new RpcError(-32602, "path is required");
    }
    const abs = resolvePath(p);
    const real = await realpathNearest(abs);
    const within = (root: string) => {
      const r = root.endsWith(sep) ? root : root + sep;
      return real === root || real.startsWith(r);
    };
    const dataReal = await safeRealpath(this.cfg.dataDir);
    if (within(dataReal)) {
      throw new RpcError(-32602, "access to add-on data is not allowed");
    }
    for (const d of this.cfg.workingDirs) {
      if (within(await safeRealpath(d.path))) return abs;
    }
    throw new RpcError(-32602, `path is outside the allowed working directories: ${p}`);
  }

  async newSession(cwd: string): Promise<NewSessionResult> {
    await this.ensureReady();
    return this.requirePeer().request<NewSessionResult>(ACP.SESSION_NEW, { cwd, mcpServers: [] });
  }

  async prompt(sessionId: string, text: string): Promise<PromptResult> {
    return this.requirePeer().request<PromptResult>(ACP.SESSION_PROMPT, {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async setMode(sessionId: string, modeId: SessionMode): Promise<void> {
    await this.requirePeer().request(ACP.SESSION_SET_MODE, { sessionId, modeId });
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.requirePeer().request(ACP.SESSION_SET_MODEL, { sessionId, modelId });
  }

  cancel(sessionId: string): void {
    this.peer?.notify(ACP.SESSION_CANCEL, { sessionId });
  }

  /** Restart the agent (e.g. after auth changed). */
  shutdown(): void {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
    }
    this.child = null;
    this.peer = null;
    this.initialized = null;
  }
}

/** Split a command string into argv, honoring simple single/double quoting. */
function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** realpath, falling back to the resolved path when it does not exist yet. */
async function safeRealpath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return resolvePath(p);
  }
}

/**
 * Resolve the real path of the nearest existing ancestor and re-append the
 * non-existent tail, so a not-yet-created file still resolves through symlinks.
 */
async function realpathNearest(abs: string): Promise<string> {
  let cur = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const r = await realpath(cur);
      return tail.length ? resolvePath(r, ...tail.reverse()) : r;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      tail.push(basename(cur));
      cur = parent;
    }
  }
}
