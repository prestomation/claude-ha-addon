# Claude Code — Home Assistant Add-on: Plan

A Home Assistant add-on that installs Claude Code and exposes a **mobile-first
web UI** in the HA sidebar (via ingress). It is **not a terminal**. When
unauthenticated it walks the user through a login flow (OAuth *or* API key).
Once authenticated it manages **ACP sessions** for Claude Code, with a minimal
session UX inspired by the Claude Code Android app: model selection and
plan/auto mode, and not much else.

## Decisions (locked)

| Area | Choice |
| --- | --- |
| Backend | **Node.js + TypeScript** (shares runtime with the ACP adapter) |
| Frontend | **Lit 3 + `@material/web`**, styled with **Home Assistant theme CSS variables** (inherits HA light/dark theming) — HA's own component stack |
| Protocol | A small **shared ACP/JSON-RPC layer** (`@addon/shared`) used by both the server (ACP client) and the mock agent |
| CI E2E | **Playwright against a deterministic mock ACP agent**, run inside the pinned Playwright Docker image; screenshots checked in; **separate secret-gated job** against a real `CLAUDE_CODE_OAUTH_TOKEN` |
| Auth | **Both** OAuth (subscription) **and** API key |

### On the frontend stack and reusing an existing ACP UI
The UI is built with **Lit + Material Web Components** and themed with Home
Assistant's CSS custom properties (`--primary-color`, `--card-background-color`,
…) plus a `prefers-color-scheme` dark mapping, so it matches HA's look and
inherits theming. `formulahendry/acp-ui` (Vue + Tauri) exists but targets a
power-user, multi-agent traffic-monitor experience — the opposite of a minimal
embedded mobile panel — so we build the thin UI ourselves.

### On the protocol layer
Rather than depend on an external ACP SDK, the repo ships a small, self-contained
ACP + JSON-RPC implementation in `@addon/shared` (ndjson framing, typed ACP
methods, the app-level WS/REST protocol). It is consumed by the server (acting as
the ACP *client*) and by the mock agent, and the real `claude-code-acp` adapter
is spawned as the production agent. This keeps the build robust and the mock
trivial; swapping in an upstream SDK later is isolated to one package.

## How the pieces fit

```
Home Assistant Supervisor
  └── ingress (https, injects X-Ingress-Path) ──▶ Add-on container
        ├── Node/TS server (Fastify)
        │     ├── serves built React SPA (base-path aware)
        │     ├── /api/auth/*      login flow + status
        │     ├── /api/sessions/*  REST for session list/create
        │     └── /ws              WebSocket  ◀────────────┐
        │            │  bridges browser <-> ACP stdio       │ browser
        │            ▼                                       │ (mobile)
        │     ACP adapter subprocess  (@zed-industries/claude-code-acp)
        │            │  stdio JSON-RPC (ACP)
        │            ▼
        │     Claude Code  (native install)  ── reads ~/.claude credentials
        └── persists creds/state under /data (HA add-on persistent volume)
```

- **Ingress** terminates at the Supervisor; our server only sees proxied
  requests and must honor the injected `X-Ingress-Path` base for all asset and
  WebSocket URLs. Ingress supports WebSockets, which we rely on for streaming.
- **One ACP adapter process** can host multiple ACP sessions
  (`session/new`, `session/load`); the server multiplexes browser WS clients to
  sessions. (Start simple: one adapter process, N sessions.)

## Authentication flow

Claude Code stores credentials in `~/.claude/.credentials.json`; we point
`HOME`/`CLAUDE_CONFIG_DIR` at `/data` so creds persist across restarts.

1. **Unauthenticated** → server reports `authenticated: false`; UI shows a
   login screen with two paths:
   - **OAuth (Pro/Max/Team)**: drive `claude setup-token`, which produces a
     browser URL; user signs in, pastes the returned code back into the UI;
     server completes the flow and stores the long-lived
     `CLAUDE_CODE_OAUTH_TOKEN`. (Paste-code flow works headlessly behind
     ingress, where we cannot open a local browser.)
   - **API key**: user pastes an `ANTHROPIC_API_KEY`; validated with a cheap
     test call, then stored.
2. Server detects auth state on boot and after each flow; transitions UI to the
   session view. A "sign out" clears stored credentials.

Secrets are written to the add-on's private `/data` volume, never logged, never
committed.

## Session UX (mobile-first, Claude-Code-Android-like)

- **Session list / new session** (pick working directory from the mapped HA
  folders: `/homeassistant`, `/share`, `/media`).
- **In-session**, only:
  - **Model selector** (via ACP capabilities / model list).
  - **Mode toggle: Plan vs Auto** (ACP `session/set_mode`).
  - Streaming transcript: assistant text, tool calls, plan updates
    (`session/update` notifications).
  - **Permission prompts** (`session/request_permission`) surfaced as mobile
    bottom-sheet approve/deny.
  - Composer: text + send/stop (cancel turn).
- Layout: full-height, touch targets, safe-area insets, sticky composer,
  no horizontal scroll. Tested at phone widths in CI.

## Repository layout

```
/
├── claude_code/                 # the HA add-on (folder name = slug)
│   ├── config.yaml              # ingress:true, panel_icon/title, maps, arch
│   ├── build.yaml               # base images per arch
│   ├── Dockerfile               # install Node + Claude Code + adapter + app
│   ├── rootfs/                  # s6-overlay services + run scripts
│   ├── apparmor.txt
│   ├── icon.png / logo.png
│   ├── translations/
│   └── CHANGELOG.md
├── server/                      # Node/TS backend (built into the image)
│   ├── src/ (fastify, auth, acp-bridge, ws)
│   └── test/
├── web/                         # React + Vite + Tailwind SPA
│   ├── src/ (auth screens, session list, session view, acp client)
│   └── test/
├── mock-acp/                    # deterministic ACP agent for CI + local dev
├── e2e/                         # Playwright specs + checked-in screenshots
├── .github/workflows/           # lint, unit, e2e(mock), e2e(real, gated), build
├── repository.yaml              # makes this an HA add-on repository
└── README.md
```

## CI / testing strategy

- **Lint + typecheck + unit** (server, web) on every PR.
- **E2E (mock)** — the gate that produces screenshots:
  - Boots server pointed at `mock-acp` (a small Node process speaking ACP over
    stdio with scripted `session/update` streams: text, tool call, plan update,
    permission request).
  - Playwright drives real auth + session flows at **mobile and desktop
    viewports**; captures screenshots to `e2e/screenshots/`.
  - **PRs touching UI must update checked-in screenshots**; CI fails if the
    committed screenshots don't match the freshly rendered ones (visual
    regression). This satisfies "all UI PRs include screenshots."
- **E2E (real, gated)** — only when `CLAUDE_CODE_OAUTH_TOKEN` secret is present
  (skipped on forks): smoke test that the real adapter authenticates and
  completes one tiny prompt turn. Non-blocking / informational.
- **Add-on build** — `home-assistant/builder` builds the image for `amd64` +
  `aarch64` to catch Dockerfile/arch breakage.

## Milestones

1. **Add-on skeleton boots in HA** — `config.yaml`/`Dockerfile`/`repository.yaml`,
   installs Claude Code + Node, serves a "hello" SPA in the sidebar over ingress
   (base-path correct). *Exit: panel loads on a real HA instance.*
2. **Auth flow** — status endpoint + OAuth(setup-token paste) + API-key screens;
   creds persist in `/data`. *Exit: go from logged-out to logged-in in UI.*
3. **ACP bridge + mock agent** — server spawns adapter, WS bridge, one session;
   build `mock-acp`. *Exit: send a prompt, see streamed reply (mock + real).*
4. **Session UX** — session list, model selector, plan/auto toggle, permission
   sheets, cancel. *Exit: full mobile session loop.*
5. **CI + screenshots** — Playwright mock E2E with checked-in screenshots,
   gated real-token job, multi-arch build. *Exit: green CI, screenshots in repo.*
6. **Polish** — translations, icon/logo, README/install docs, apparmor, error
   states, reconnect handling.

## Key risks / things to verify during build

- Exact ACP package + invocation (`@zed-industries/claude-code-acp` vs the
  renamed `@agentclientprotocol/claude-agent-acp`) and how model list / modes
  are exposed over ACP — verify against the installed version.
- `claude setup-token` exact prompts/output for scripting the paste flow.
- Ingress base-path handling for SPA assets **and** the WebSocket URL.
- Persisting `~/.claude` to `/data` (set `HOME`/`CLAUDE_CONFIG_DIR`).
- Multi-arch base image + Claude Code native install on the HA base image
  (musl/Alpine vs Debian; pick a base accordingly).
```
