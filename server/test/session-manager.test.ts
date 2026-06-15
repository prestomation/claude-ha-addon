import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerMessage, NewSessionResult } from "@addon/shared";
import { SessionManager } from "../src/session-manager.js";
import type { AcpAgent } from "../src/acp-agent.js";

class StubAgent extends EventEmitter {
  async newSession(): Promise<NewSessionResult> {
    return {
      sessionId: "s1",
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Auto" },
          { id: "plan", name: "Plan" },
        ],
      },
      models: {
        currentModelId: "m1",
        availableModels: [
          { id: "m1", name: "One" },
          { id: "m2", name: "Two" },
        ],
      },
    };
  }
  async prompt() {
    return { stopReason: "end_turn" as const };
  }
  async setMode() {}
  async setModel() {}
  cancel() {}
}

describe("SessionManager", () => {
  let agent: StubAgent;
  let mgr: SessionManager;
  let messages: ServerMessage[];

  beforeEach(async () => {
    agent = new StubAgent();
    mgr = new SessionManager(agent as unknown as AcpAgent);
    messages = [];
    mgr.addClient((m) => messages.push(m));
    await mgr.newSession("/tmp/work");
  });

  it("announces a created session with modes and models", () => {
    const created = messages.find((m) => m.type === "session_created");
    expect(created).toBeTruthy();
    if (created?.type === "session_created") {
      expect(created.session.id).toBe("s1");
      expect(created.session.currentModeId).toBe("default");
      expect(created.session.models).toHaveLength(2);
    }
  });

  it("accumulates streamed assistant text into one item", () => {
    agent.emit("update", {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } },
    });
    agent.emit("update", {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } },
    });
    const appends = messages.filter((m) => m.type === "transcript_append");
    const updates = messages.filter((m) => m.type === "transcript_update");
    expect(appends).toHaveLength(1);
    expect(updates).toHaveLength(1);
    if (updates[0].type === "transcript_update") {
      expect((updates[0].patch as { text: string }).text).toBe("Hello world");
    }
  });

  it("patches tool call status by toolCallId", () => {
    agent.emit("update", {
      sessionId: "s1",
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read x", status: "in_progress" },
    });
    agent.emit("update", {
      sessionId: "s1",
      update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" },
    });
    const update = messages.find((m) => m.type === "transcript_update");
    expect(update).toBeTruthy();
    if (update?.type === "transcript_update") {
      expect((update.patch as { status: string }).status).toBe("completed");
    }
  });

  it("routes permission requests and responses", async () => {
    let resolved: unknown = null;
    agent.emit("permission", {
      params: {
        sessionId: "s1",
        toolCall: { toolCallId: "t9", title: "Run cmd" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
      },
      resolve: (r: unknown) => {
        resolved = r;
      },
    });
    const req = messages.find((m) => m.type === "permission_request");
    expect(req).toBeTruthy();
    if (req?.type === "permission_request") {
      mgr.respondPermission("s1", req.requestId, "allow");
    }
    expect(resolved).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  });
});
