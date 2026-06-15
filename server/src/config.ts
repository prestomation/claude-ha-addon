import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { WorkingDir } from "@addon/shared";

const here = dirname(fileURLToPath(import.meta.url));
// dist/ -> server/ -> repo root
const repoRoot = resolve(here, "..", "..");

function parseWorkingDirs(): WorkingDir[] {
  // ACP_WORKING_DIRS="path|Label,path2|Label2"
  const raw = process.env.ACP_WORKING_DIRS;
  if (raw && raw.trim().length > 0) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [path, label] = entry.split("|");
        return { path: path.trim(), label: (label ?? path).trim() };
      });
  }
  // Default: the standard Home Assistant mapped folders that actually exist.
  const candidates: WorkingDir[] = [
    { path: process.env.WORKING_DIRECTORY ?? "/homeassistant", label: "Home Assistant config" },
    { path: "/share", label: "Share" },
    { path: "/media", label: "Media" },
  ];
  const existing = candidates.filter((d) => existsSync(d.path));
  if (existing.length > 0) return existing;
  // Dev/mock fallback so the UI always has a selectable directory.
  return [{ path: process.cwd(), label: "Workspace" }];
}

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  webDist: string;
  mock: boolean;
  agentCmd: string;
  workingDirs: WorkingDir[];
  logLevel: string;
}

export function loadConfig(): ServerConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 8099),
    dataDir: process.env.DATA_DIR ?? "/data",
    webDist: process.env.WEB_DIST ?? resolve(repoRoot, "web", "dist"),
    mock: process.env.ACP_MOCK === "1",
    agentCmd: process.env.ACP_AGENT_CMD ?? "claude-code-acp",
    workingDirs: parseWorkingDirs(),
    logLevel: (process.env.LOG_LEVEL ?? "info").toLowerCase(),
  };
}
