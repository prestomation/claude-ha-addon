/**
 * Agent Client Protocol (ACP) method names and the subset of message shapes
 * this add-on uses. Based on the ACP spec (JSON-RPC 2.0 over stdio).
 *
 * We deliberately model only what the UI needs: initialize, authenticate,
 * session lifecycle, prompt turns, streaming updates, mode/model selection and
 * permission requests. The real adapter (@zed-industries/claude-code-acp) and
 * our mock agent both speak these.
 */

export const ACP = {
  // client -> agent (requests)
  INITIALIZE: "initialize",
  AUTHENTICATE: "authenticate",
  SESSION_NEW: "session/new",
  SESSION_LOAD: "session/load",
  SESSION_PROMPT: "session/prompt",
  SESSION_SET_MODE: "session/set_mode",
  SESSION_SET_MODEL: "session/set_model",
  // client -> agent (notifications)
  SESSION_CANCEL: "session/cancel",
  // agent -> client (notifications)
  SESSION_UPDATE: "session/update",
  // agent -> client (requests)
  SESSION_REQUEST_PERMISSION: "session/request_permission",
  FS_READ_TEXT_FILE: "fs/read_text_file",
  FS_WRITE_TEXT_FILE: "fs/write_text_file",
} as const;

export const ACP_PROTOCOL_VERSION = 1;

export type SessionMode = "default" | "plan" | "acceptEdits" | string;

export interface AcpModeInfo {
  id: SessionMode;
  name: string;
  description?: string;
}

export interface AcpModelInfo {
  id: string;
  name: string;
  description?: string;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: Record<string, unknown>;
  authMethods?: { id: string; name: string; description?: string }[];
}

export interface NewSessionParams {
  cwd: string;
  mcpServers?: unknown[];
}

export interface NewSessionResult {
  sessionId: string;
  modes?: { currentModeId: SessionMode; availableModes: AcpModeInfo[] };
  models?: { currentModelId: string; availableModels: AcpModelInfo[] };
}

export interface PromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export interface PromptResult {
  stopReason: StopReason;
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource_link"; uri: string; name?: string };

/** The payload of a `session/update` notification. */
export interface SessionUpdateNotification {
  sessionId: string;
  update: SessionUpdate;
}

export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: ContentBlock }
  | { sessionUpdate: "user_message_chunk"; content: ContentBlock }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title: string;
      kind?: string;
      status?: ToolCallStatus;
      rawInput?: unknown;
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      status?: ToolCallStatus;
      title?: string;
      content?: ToolCallContent[];
    }
  | { sessionUpdate: "plan"; entries: PlanEntry[] }
  | { sessionUpdate: "current_mode_update"; currentModeId: SessionMode }
  | { sessionUpdate: "current_model_update"; currentModelId: string };

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface ToolCallContent {
  type: "content" | "diff";
  content?: ContentBlock;
  path?: string;
  oldText?: string | null;
  newText?: string;
}

export interface PlanEntry {
  content: string;
  priority?: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/** `session/request_permission` params (agent -> client). */
export interface RequestPermissionParams {
  sessionId: string;
  toolCall: { toolCallId: string; title: string; kind?: string };
  options: PermissionOption[];
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface RequestPermissionResult {
  outcome:
    | { outcome: "selected"; optionId: string }
    | { outcome: "cancelled" };
}
