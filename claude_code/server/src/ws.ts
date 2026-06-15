import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@addon/shared";
import type { AppContext } from "./app-context.js";

/** Registers the `/ws` endpoint that bridges the browser to the SessionManager. */
export function registerWebSocket(app: FastifyInstance, ctx: AppContext): void {
  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const send = (msg: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    const remove = ctx.sessions.addClient(send);

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send({ type: "error", message: "invalid message" });
        return;
      }
      void handle(ctx, msg, send);
    });

    socket.on("close", () => remove());
    socket.on("error", () => remove());
  });
}

async function handle(
  ctx: AppContext,
  msg: ClientMessage,
  send: (m: ServerMessage) => void,
): Promise<void> {
  try {
    switch (msg.type) {
      case "ping":
        send({ type: "pong" });
        break;
      case "new_session":
        await ctx.sessions.newSession(msg.cwd);
        break;
      case "load_session":
        ctx.sessions.loadSession(msg.sessionId);
        break;
      case "prompt":
        await ctx.sessions.prompt(msg.sessionId, msg.text);
        break;
      case "cancel":
        ctx.sessions.cancel(msg.sessionId);
        break;
      case "set_mode":
        await ctx.sessions.setMode(msg.sessionId, msg.modeId);
        break;
      case "set_model":
        await ctx.sessions.setModel(msg.sessionId, msg.modelId);
        break;
      case "permission_response":
        ctx.sessions.respondPermission(msg.sessionId, msg.requestId, msg.optionId);
        break;
    }
  } catch (err) {
    send({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      sessionId: "sessionId" in msg ? (msg as { sessionId: string }).sessionId : undefined,
    });
  }
}
