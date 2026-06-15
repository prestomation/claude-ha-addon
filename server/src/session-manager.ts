import { randomUUID } from "node:crypto";
import type {
  AcpModeInfo,
  AcpModelInfo,
  ContentBlock,
  PlanEntry,
  RequestPermissionParams,
  RequestPermissionResult,
  ServerMessage,
  SessionInfo,
  SessionMode,
  SessionUpdate,
  SessionUpdateNotification,
  ToolCallStatus,
  TranscriptItem,
} from "@addon/shared";
import type { AcpAgent } from "./acp-agent.js";

type Send = (msg: ServerMessage) => void;

interface SessionRuntime {
  info: SessionInfo;
  transcript: TranscriptItem[];
  turnActive: boolean;
  currentTextId?: string;
  currentThoughtId?: string;
  currentPlanId?: string;
  toolItemIds: Map<string, string>; // ACP toolCallId -> transcript item id
  pendingPermissions: Map<string, (r: RequestPermissionResult) => void>;
}

const DEFAULT_MODES: AcpModeInfo[] = [
  { id: "default", name: "Auto" },
  { id: "plan", name: "Plan" },
];

/**
 * Bridges ACP agent events to the browser-facing protocol and owns per-session
 * transcript state. There is one shared agent across sessions; this is a single
 * user add-on so all connected sockets see the same sessions.
 */
export class SessionManager {
  private readonly agent: AcpAgent;
  private readonly clients = new Set<Send>();
  private readonly sessions = new Map<string, SessionRuntime>();

  constructor(agent: AcpAgent) {
    this.agent = agent;
    agent.on("update", (n: SessionUpdateNotification) => this.onUpdate(n));
    agent.on(
      "permission",
      (p: { params: RequestPermissionParams; resolve: (r: RequestPermissionResult) => void }) =>
        this.onPermission(p.params, p.resolve),
    );
  }

  addClient(send: Send): () => void {
    this.clients.add(send);
    return () => this.clients.delete(send);
  }

  private broadcast(msg: ServerMessage): void {
    for (const send of this.clients) {
      try {
        send(msg);
      } catch {
        /* a dead socket; it will be removed on close */
      }
    }
  }

  async newSession(cwd: string): Promise<void> {
    const result = await this.agent.newSession(cwd);
    const modes = result.modes?.availableModes ?? DEFAULT_MODES;
    const models: AcpModelInfo[] = result.models?.availableModels ?? [];
    const info: SessionInfo = {
      id: result.sessionId,
      cwd,
      modes,
      currentModeId: result.modes?.currentModeId ?? modes[0]?.id ?? "default",
      models,
      currentModelId: result.models?.currentModelId ?? models[0]?.id ?? "",
    };
    this.sessions.set(info.id, {
      info,
      transcript: [],
      turnActive: false,
      toolItemIds: new Map(),
      pendingPermissions: new Map(),
    });
    this.broadcast({ type: "session_created", session: info });
  }

  loadSession(sessionId: string): void {
    const rt = this.sessions.get(sessionId);
    if (!rt) {
      this.broadcast({ type: "error", message: `Unknown session ${sessionId}`, sessionId });
      return;
    }
    this.broadcast({ type: "session_loaded", session: rt.info, transcript: rt.transcript });
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const rt = this.requireSession(sessionId);
    rt.turnActive = true;
    rt.currentTextId = undefined;
    rt.currentThoughtId = undefined;
    rt.currentPlanId = undefined;
    this.broadcast({ type: "turn_started", sessionId });
    try {
      const result = await this.agent.prompt(sessionId, text);
      rt.turnActive = false;
      this.broadcast({ type: "turn_done", sessionId, stopReason: result.stopReason });
    } catch (err) {
      rt.turnActive = false;
      this.broadcast({
        type: "error",
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
      this.broadcast({ type: "turn_done", sessionId, stopReason: "refusal" });
    }
  }

  cancel(sessionId: string): void {
    this.agent.cancel(sessionId);
  }

  async setMode(sessionId: string, modeId: SessionMode): Promise<void> {
    const rt = this.requireSession(sessionId);
    await this.agent.setMode(sessionId, modeId);
    rt.info.currentModeId = modeId;
    this.broadcast({ type: "mode_changed", sessionId, modeId });
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    const rt = this.requireSession(sessionId);
    await this.agent.setModel(sessionId, modelId);
    rt.info.currentModelId = modelId;
    this.broadcast({ type: "model_changed", sessionId, modelId });
  }

  respondPermission(sessionId: string, requestId: string, optionId: string | null): void {
    const rt = this.sessions.get(sessionId);
    const resolve = rt?.pendingPermissions.get(requestId);
    if (!rt || !resolve) return;
    rt.pendingPermissions.delete(requestId);
    resolve(
      optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
  }

  private onPermission(
    params: RequestPermissionParams,
    resolve: (r: RequestPermissionResult) => void,
  ): void {
    const rt = this.sessions.get(params.sessionId);
    if (!rt) {
      resolve({ outcome: { outcome: "cancelled" } });
      return;
    }
    const requestId = randomUUID();
    rt.pendingPermissions.set(requestId, resolve);
    this.broadcast({
      type: "permission_request",
      sessionId: params.sessionId,
      requestId,
      title: params.toolCall.title,
      toolKind: params.toolCall.kind,
      options: params.options,
    });
  }

  private onUpdate(n: SessionUpdateNotification): void {
    const rt = this.sessions.get(n.sessionId);
    if (!rt) return;
    const u = n.update as SessionUpdate;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        this.appendChunk(rt, "text", contentText(u.content));
        break;
      case "agent_thought_chunk":
        this.appendChunk(rt, "thought", contentText(u.content));
        break;
      case "user_message_chunk":
        // The UI echoes the user's own message locally; ignore here.
        break;
      case "tool_call": {
        this.resetInlineText(rt);
        const id = randomUUID();
        rt.toolItemIds.set(u.toolCallId, id);
        this.append(rt, {
          id,
          role: "assistant",
          kind: "tool_call",
          toolCallId: u.toolCallId,
          title: u.title,
          toolKind: u.kind,
          status: u.status ?? "in_progress",
        });
        break;
      }
      case "tool_call_update": {
        const id = rt.toolItemIds.get(u.toolCallId);
        if (!id) break;
        const patch: Partial<TranscriptItem> = {};
        if (u.status) (patch as { status?: ToolCallStatus }).status = u.status;
        if (u.title) (patch as { title?: string }).title = u.title;
        this.patch(rt, id, patch);
        break;
      }
      case "plan":
        this.resetInlineText(rt);
        if (rt.currentPlanId) {
          this.patch(rt, rt.currentPlanId, { entries: u.entries } as Partial<TranscriptItem>);
        } else {
          const id = randomUUID();
          rt.currentPlanId = id;
          this.append(rt, { id, role: "assistant", kind: "plan", entries: u.entries as PlanEntry[] });
        }
        break;
      case "current_mode_update":
        rt.info.currentModeId = u.currentModeId;
        this.broadcast({ type: "mode_changed", sessionId: n.sessionId, modeId: u.currentModeId });
        break;
      case "current_model_update":
        rt.info.currentModelId = u.currentModelId;
        this.broadcast({ type: "model_changed", sessionId: n.sessionId, modelId: u.currentModelId });
        break;
    }
  }

  private appendChunk(rt: SessionRuntime, kind: "text" | "thought", text: string): void {
    if (!text) return;
    const idKey = kind === "text" ? "currentTextId" : "currentThoughtId";
    const existingId = rt[idKey];
    if (existingId) {
      const item = rt.transcript.find((i) => i.id === existingId);
      if (item && "text" in item) {
        item.text += text;
        this.patch(rt, existingId, { text: item.text } as Partial<TranscriptItem>);
        return;
      }
    }
    const id = randomUUID();
    rt[idKey] = id;
    this.append(rt, { id, role: "assistant", kind, text } as TranscriptItem);
  }

  private resetInlineText(rt: SessionRuntime): void {
    rt.currentTextId = undefined;
    rt.currentThoughtId = undefined;
  }

  private append(rt: SessionRuntime, item: TranscriptItem): void {
    rt.transcript.push(item);
    this.broadcast({ type: "transcript_append", sessionId: rt.info.id, item });
  }

  private patch(rt: SessionRuntime, itemId: string, patch: Partial<TranscriptItem>): void {
    const item = rt.transcript.find((i) => i.id === itemId);
    if (item) Object.assign(item, patch);
    this.broadcast({ type: "transcript_update", sessionId: rt.info.id, itemId, patch });
  }

  private requireSession(sessionId: string): SessionRuntime {
    const rt = this.sessions.get(sessionId);
    if (!rt) throw new Error(`Unknown session ${sessionId}`);
    return rt;
  }
}

function contentText(content: ContentBlock): string {
  return content.type === "text" ? content.text : "";
}
