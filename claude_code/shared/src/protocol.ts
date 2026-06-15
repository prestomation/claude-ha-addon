/**
 * App-level protocol between the browser UI and the add-on server.
 *
 * The browser does NOT speak raw ACP. The server is the ACP client; it exposes
 * a small, stable WebSocket + REST API to the UI and translates to/from ACP.
 * This keeps the mobile UI simple and lets the server own auth, permission
 * routing, model/mode state and reconnection.
 */

import type {
  AcpModeInfo,
  AcpModelInfo,
  PermissionOption,
  PlanEntry,
  SessionMode,
  StopReason,
  ToolCallStatus,
} from "./acp.js";

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export type AuthMethod = "oauth" | "apikey" | "none";

export interface StatusResponse {
  authenticated: boolean;
  method: AuthMethod;
  claudeVersion: string | null;
  /** True once Claude Code + the ACP adapter are installed and runnable. */
  ready: boolean;
}

export interface WorkingDir {
  path: string;
  label: string;
}

export interface DirsResponse {
  dirs: WorkingDir[];
}

export interface ApiKeyLoginRequest {
  apiKey: string;
}

/** Begins the OAuth (`claude setup-token`) flow; returns a URL to open. */
export interface OAuthStartResponse {
  /** URL the user opens in a browser to authorize. */
  url: string;
  /** Opaque handle to correlate the completion step. */
  flowId: string;
}

export interface OAuthCompleteRequest {
  flowId: string;
  /** The authorization code pasted back by the user. */
  code: string;
}

export interface SimpleResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// WebSocket — client (browser) -> server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "new_session"; cwd: string }
  | { type: "load_session"; sessionId: string }
  | { type: "prompt"; sessionId: string; text: string }
  | { type: "cancel"; sessionId: string }
  | { type: "set_mode"; sessionId: string; modeId: SessionMode }
  | { type: "set_model"; sessionId: string; modelId: string }
  | {
      type: "permission_response";
      sessionId: string;
      requestId: string;
      /** optionId to select, or null to cancel. */
      optionId: string | null;
    }
  | { type: "ping" };

// ---------------------------------------------------------------------------
// WebSocket — server -> client (browser)
// ---------------------------------------------------------------------------

export interface SessionInfo {
  id: string;
  cwd: string;
  modes: AcpModeInfo[];
  currentModeId: SessionMode;
  models: AcpModelInfo[];
  currentModelId: string;
}

/** A flattened transcript item the UI renders. */
export type TranscriptItem =
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "thought"; text: string }
  | {
      id: string;
      role: "assistant";
      kind: "tool_call";
      toolCallId: string;
      title: string;
      toolKind?: string;
      status: ToolCallStatus;
    }
  | { id: string; role: "assistant"; kind: "plan"; entries: PlanEntry[] };

export type ServerMessage =
  | { type: "session_created"; session: SessionInfo }
  | { type: "session_loaded"; session: SessionInfo; transcript: TranscriptItem[] }
  | { type: "transcript_append"; sessionId: string; item: TranscriptItem }
  | {
      type: "transcript_update";
      sessionId: string;
      itemId: string;
      patch: Partial<TranscriptItem>;
    }
  | { type: "mode_changed"; sessionId: string; modeId: SessionMode }
  | { type: "model_changed"; sessionId: string; modelId: string }
  | {
      type: "permission_request";
      sessionId: string;
      requestId: string;
      title: string;
      toolKind?: string;
      options: PermissionOption[];
    }
  | { type: "turn_started"; sessionId: string }
  | { type: "turn_done"; sessionId: string; stopReason: StopReason }
  | { type: "agent_stopped"; message: string }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "pong" };
