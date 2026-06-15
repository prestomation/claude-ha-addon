import type { FastifyInstance } from "fastify";
import type {
  ApiKeyLoginRequest,
  DirsResponse,
  OAuthCompleteRequest,
  OAuthStartResponse,
  SimpleResult,
  StatusResponse,
} from "@addon/shared";
import type { AppContext } from "./app-context.js";

/** Registers the REST API under /api. */
export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/status", async (): Promise<StatusResponse> => {
    return ctx.auth.status();
  });

  app.get("/api/dirs", async (): Promise<DirsResponse> => {
    return { dirs: ctx.config.workingDirs };
  });

  app.post("/api/auth/apikey", async (req, reply): Promise<SimpleResult> => {
    const body = req.body as ApiKeyLoginRequest;
    try {
      await ctx.auth.loginApiKey(body?.apiKey ?? "");
      ctx.agent.shutdown(); // pick up the new credential on next use
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/auth/oauth/start", async (_req, reply): Promise<OAuthStartResponse | SimpleResult> => {
    try {
      return await ctx.auth.oauthStart();
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/auth/oauth/complete", async (req, reply): Promise<SimpleResult> => {
    const body = req.body as OAuthCompleteRequest;
    try {
      await ctx.auth.oauthComplete(body?.flowId ?? "", body?.code ?? "");
      ctx.agent.shutdown();
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/auth/logout", async (): Promise<SimpleResult> => {
    ctx.auth.logout();
    ctx.agent.shutdown();
    return { ok: true };
  });
}
