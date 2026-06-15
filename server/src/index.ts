import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { createAppContext } from "./app-context.js";
import { registerRoutes } from "./routes.js";
import { registerWebSocket } from "./ws.js";

function fastifyLogLevel(level: string): string {
  if (level === "warning") return "warn";
  if (["trace", "debug", "info", "warn", "error", "fatal"].includes(level)) return level;
  return "info";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({
    logger: { level: fastifyLogLevel(config.logLevel) },
    // HA ingress sits in front of us; trust its forwarding headers.
    trustProxy: true,
  });

  const ctx = createAppContext(config);

  // Some POSTs (oauth/start, logout) send `content-type: application/json` with
  // no body; treat an empty JSON body as `{}` instead of a 400.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const text = (body as string).trim();
      if (text.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err instanceof Error ? err : new Error("invalid JSON"), undefined);
      }
    },
  );

  await app.register(fastifyWebsocket);
  registerRoutes(app, ctx);
  registerWebSocket(app, ctx);

  // Serve the built SPA, with a not-found fallback to index.html so the
  // client-side app can handle its own view state under HA ingress.
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  } else {
    app.log.warn(`web dist not found at ${config.webDist}; UI will not be served`);
    app.get("/", async () => ({ status: "server running, UI not built" }));
  }

  app.log.info(
    `starting in ${config.mock ? "MOCK" : "real"} mode; agent="${config.agentCmd}"; dataDir=${config.dataDir}`,
  );

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
