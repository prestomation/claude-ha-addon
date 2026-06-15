# Internal build contract

> **Layout note:** all app packages live under the add-on directory
> `claude_code/` (so the add-on folder is the Docker build context). Paths below
> are written relative to `claude_code/` — e.g. `server/src/...` means
> `claude_code/server/src/...`.

This file pins the shapes and conventions every package must follow so the
parts integrate. Source of truth for types is `shared/src/*` (package
`@addon/shared`). Read those files; do not redefine these types locally.

## Monorepo

- npm workspaces: `shared`, `server`, `web`, `mock-acp`, `e2e`.
- ESM everywhere (`"type": "module"`). Node >= 20. TypeScript 5.6.
- Each package extends `../tsconfig.base.json`.
- Do NOT run `npm install` from within a package — the root owns the lockfile.

## Components

```
browser (Lit UI)  --REST + WS-->  server (Fastify, ACP client)  --stdio ACP-->  agent
                                                                                  ├─ prod: claude-code-acp (real)
                                                                                  └─ test/dev: mock-acp
```

## Server (package `server`)

- Fastify app listening on `0.0.0.0:${PORT|8099}`.
- Serves the built web SPA (static) for all non-API routes, so HA ingress can
  load it. Static dir: `process.env.WEB_DIST ?? <repo>/web/dist`.
- REST (see `shared/src/protocol.ts` for types):
  - `GET  /api/status` -> `StatusResponse`
  - `GET  /api/dirs` -> `DirsResponse`
  - `POST /api/auth/apikey` body `ApiKeyLoginRequest` -> `SimpleResult`
  - `POST /api/auth/oauth/start` -> `OAuthStartResponse`
  - `POST /api/auth/oauth/complete` body `OAuthCompleteRequest` -> `SimpleResult`
  - `POST /api/auth/logout` -> `SimpleResult`
- WebSocket at `/ws`: messages are `ClientMessage` (in) / `ServerMessage` (out),
  JSON text frames.
- Spawns the ACP agent via `ACP_AGENT_CMD` (shell-split). Default real command
  is `claude-code-acp`. It is the ACP *client* using `JsonRpcPeer` from shared.
- Auth state stored under `DATA_DIR` (default `/data`). `HOME`/`CLAUDE_CONFIG_DIR`
  point at `DATA_DIR` so Claude creds persist.
- Mock mode: when `ACP_MOCK=1`, auth is simulated (any non-empty API key works;
  OAuth start returns a fake URL; any code completes), `claudeVersion` = "mock".

## Web (package `web`)

- Lit 3 + `@material/web` components, Vite build, output `web/dist`, `base: './'`
  (relative URLs — required for ingress base path).
- Connects WS to `new URL('ws', documentBaseRelative)` honoring the ingress base
  path (use `<base>`/`document.baseURI`). All fetch() use relative `api/...`.
- Home Assistant theming: style with HA CSS custom properties
  (`--primary-color`, `--card-background-color`, `--primary-text-color`,
  `--secondary-text-color`, `--divider-color`, `--ha-card-border-radius`, etc.)
  with fallbacks matching HA default light theme, and a dark theme via
  `@media (prefers-color-scheme: dark)` setting those same variables.
- Views: AuthView (logged out: OAuth + API key tabs), SessionListView (pick a
  working dir / start session), SessionView (transcript, model selector,
  plan/auto mode toggle, permission bottom-sheet, composer with send/stop).
- A `Connection` module wraps REST + WS using `shared` types.
- Mobile-first: full-height flex, sticky composer, safe-area insets, large
  touch targets, no horizontal scroll. Must look right at 390px width.
- Expose `data-testid` attributes for E2E selectors (see e2e/README).

## mock-acp (package `mock-acp`)

- Node program: ACP *agent* over stdin/stdout using `JsonRpcPeer` from shared.
- Implements: `initialize`, `authenticate`, `session/new` (returns modes
  default/plan + two models), `session/prompt` (emits a scripted stream of
  `session/update`: user echo, a thought, an `agent_message_chunk`, a `tool_call`
  + `tool_call_update`, optionally a `plan` in plan mode, and one
  `session/request_permission` round-trip), `session/set_mode`, `session/set_model`,
  `session/cancel`.
- Deterministic output keyed off the prompt text so screenshots are stable.

## e2e (package `e2e`)

- Playwright. `webServer` builds shared+server+web, then starts the server with
  `ACP_MOCK=1` and `ACP_AGENT_CMD="node <repo>/mock-acp/dist/index.js"`.
- Specs cover: login (API key + OAuth paste), start session, send prompt + see
  stream, switch plan/auto, switch model, approve a permission.
- Captures screenshots into `e2e/screenshots/` at mobile (390x844) and desktop
  (1280x800) viewports. These are committed. A visual check fails CI if the UI
  changed without updating them.
