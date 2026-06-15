/**
 * Mock ACP agent — speaks the agent side of the Agent Client Protocol over
 * stdin/stdout, with deterministic, scripted output. Used by E2E and local dev
 * so the full UI + server path can be exercised without real Claude Code.
 *
 * Determinism: all streamed content is derived from the prompt text and the
 * current mode, with fixed ordering, so screenshots are stable.
 */

import {
  ACP,
  ACP_PROTOCOL_VERSION,
  JsonRpcPeer,
  type NewSessionResult,
  type PromptParams,
  type RequestPermissionResult,
  type SessionMode,
} from "@addon/shared";

interface SessionState {
  mode: SessionMode;
  model: string;
  cancelled: boolean;
}

const sessions = new Map<string, SessionState>();
let sessionCounter = 0;
let toolCounter = 0;

const peer = new JsonRpcPeer({
  send: (line) => process.stdout.write(line),
  onError: (err) => process.stderr.write(`[mock-acp] ${err.message}\n`),
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => peer.receive(chunk));
process.stdin.on("end", () => process.exit(0));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function update(sessionId: string, payload: Record<string, unknown>): void {
  peer.notify(ACP.SESSION_UPDATE, { sessionId, update: payload });
}

peer.onRequest(ACP.INITIALIZE, () => ({
  protocolVersion: ACP_PROTOCOL_VERSION,
  agentCapabilities: { promptCapabilities: { image: true } },
  authMethods: [
    { id: "oauth", name: "Claude subscription" },
    { id: "apikey", name: "API key" },
  ],
}));

peer.onRequest(ACP.AUTHENTICATE, () => ({}));

peer.onRequest(ACP.SESSION_NEW, (): NewSessionResult => {
  const sessionId = `mock-${++sessionCounter}`;
  sessions.set(sessionId, {
    mode: "default",
    model: "claude-sonnet-4-6",
    cancelled: false,
  });
  return {
    sessionId,
    modes: {
      currentModeId: "default",
      availableModes: [
        { id: "default", name: "Auto", description: "Claude edits and runs autonomously" },
        { id: "plan", name: "Plan", description: "Claude plans before acting" },
      ],
    },
    models: {
      currentModelId: "claude-sonnet-4-6",
      availableModels: [
        { id: "claude-sonnet-4-6", name: "Sonnet 4.6" },
        { id: "claude-opus-4-8", name: "Opus 4.8" },
      ],
    },
  };
});

peer.onRequest(ACP.SESSION_LOAD, (params) => {
  const { sessionId } = params as { sessionId: string };
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { mode: "default", model: "claude-sonnet-4-6", cancelled: false });
  }
  return {};
});

peer.onRequest(ACP.SESSION_SET_MODE, (params) => {
  const { sessionId, modeId } = params as { sessionId: string; modeId: SessionMode };
  const s = sessions.get(sessionId);
  if (s) s.mode = modeId;
  return {};
});

peer.onRequest(ACP.SESSION_SET_MODEL, (params) => {
  const { sessionId, modelId } = params as { sessionId: string; modelId: string };
  const s = sessions.get(sessionId);
  if (s) s.model = modelId;
  return {};
});

peer.onNotification(ACP.SESSION_CANCEL, (params) => {
  const { sessionId } = params as { sessionId: string };
  const s = sessions.get(sessionId);
  if (s) s.cancelled = true;
});

peer.onRequest(ACP.SESSION_PROMPT, async (params) => {
  const { sessionId, prompt } = params as PromptParams;
  const s = sessions.get(sessionId) ?? {
    mode: "default" as SessionMode,
    model: "claude-sonnet-4-6",
    cancelled: false,
  };
  s.cancelled = false;
  const text = prompt
    .map((b) => (b.type === "text" ? b.text : ""))
    .join(" ")
    .trim();

  await sleep(40);
  if (s.cancelled) return { stopReason: "cancelled" };

  update(sessionId, {
    sessionUpdate: "agent_thought_chunk",
    content: textBlock(`Considering your request: "${text}".`),
  });
  await sleep(60);

  if (s.mode === "plan") {
    update(sessionId, {
      sessionUpdate: "plan",
      entries: [
        { content: "Review the relevant files", status: "completed", priority: "high" },
        { content: "Draft the change", status: "in_progress", priority: "medium" },
        { content: "Run tests", status: "pending", priority: "low" },
      ],
    });
    await sleep(60);
  }

  // A tool call that runs to completion.
  const toolCallId = `tool-${++toolCounter}`;
  update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId,
    title: "Read /homeassistant/configuration.yaml",
    kind: "read",
    status: "in_progress",
  });
  await sleep(80);
  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: "completed",
  });

  // Optional permission round-trip when the user asks for it.
  if (/permission|deploy|approve/i.test(text)) {
    const res = (await peer.request(ACP.SESSION_REQUEST_PERMISSION, {
      sessionId,
      toolCall: { toolCallId: `tool-${++toolCounter}`, title: "Run shell command: ha core restart", kind: "execute" },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    })) as RequestPermissionResult;
    const allowed = res.outcome.outcome === "selected" && res.outcome.optionId === "allow";
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: textBlock(allowed ? "Permission granted — proceeding.\n\n" : "Permission denied — stopping.\n\n"),
    });
    await sleep(40);
    if (!allowed) return { stopReason: "end_turn" };
  }

  if (s.cancelled) return { stopReason: "cancelled" };

  const reply =
    s.mode === "plan"
      ? `Here's my plan for "${text}". I'll start once you switch to Auto mode.`
      : `Done. I handled "${text}" using ${s.model}.`;
  // Stream the reply in a couple of chunks.
  for (const part of [reply.slice(0, Math.ceil(reply.length / 2)), reply.slice(Math.ceil(reply.length / 2))]) {
    if (s.cancelled) return { stopReason: "cancelled" };
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: textBlock(part) });
    await sleep(50);
  }

  return { stopReason: s.cancelled ? "cancelled" : "end_turn" };
});

process.stderr.write("[mock-acp] ready\n");
