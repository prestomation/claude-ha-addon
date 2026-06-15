# Claude Code — Home Assistant Add-on

Run [Claude Code](https://www.anthropic.com/claude-code) inside Home Assistant
with a **mobile-first chat UI right in the HA sidebar**. This is *not* a web
terminal — it is a purpose-built session UI that talks to Claude Code over the
[Agent Client Protocol (ACP)](https://agentclientprotocol.com/): start a
session, stream Claude's responses, switch models, toggle plan/auto mode, watch
tool calls, and approve permissions, all from your phone or desktop.

The add-on serves its UI through Home Assistant **ingress**, so there are no
exposed ports and it appears as a panel ("Claude Code") in your sidebar.

## Features

- Sidebar panel via ingress — no ports, no extra auth, HA handles access.
- Mobile-first UI (looks right down to 390px): sticky composer, safe-area
  insets, large touch targets, HA light/dark theming.
- Sign in with your Anthropic / Claude account (OAuth) **or** an API key.
- Start sessions in your HA config or other mapped folders, stream replies,
  switch between models, switch plan/auto mode, and approve tool permissions
  from a bottom sheet.
- Credentials persist across restarts on the add-on's private `/data` volume.

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Open the **⋮** menu (top right) → **Repositories**.
3. Add this repository URL:

   ```
   https://github.com/prestomation/claude-ha-addon
   ```

4. Find **Claude Code** in the store and click **Install**.
5. Start the add-on. Open it from the **Claude Code** entry in your sidebar.

> The panel is admin-only (`panel_admin: true`): only Home Assistant
> administrators can see and use it.

## Authentication

On first open you'll see a login screen with two options:

- **Sign in with Claude (OAuth):** click to start, complete the flow in your
  browser, and paste the returned code back into the UI.
- **API key:** paste an Anthropic API key.

Credentials are stored under the add-on's `/data` volume (`HOME` and
`CLAUDE_CONFIG_DIR` point there), so you stay signed in across restarts and
updates. Use **Log out** in the UI to clear them.

## Options

| Option              | Type | Default          | Description                                                                 |
| ------------------- | ---- | ---------------- | --------------------------------------------------------------------------- |
| `log_level`         | list | `info`           | Log verbosity: `debug`, `info`, `warning`, or `error`.                      |
| `working_directory` | str  | `/homeassistant` | Default folder a new session starts in (your HA config dir by default).     |

### Folder access

The add-on maps these host folders:

| Mapping                  | Access     | Path in add-on   |
| ------------------------ | ---------- | ---------------- |
| Home Assistant config    | read/write | `/homeassistant` |
| Share                    | read/write | `/share`         |
| Media                    | read/write | `/media`         |
| SSL                      | read-only  | `/ssl`           |
| Backup                   | read-only  | `/backup`        |

It also gets a private, persistent `/data` volume automatically (used for auth
credentials and Claude config) — no configuration required.

## Architecture

The repository is an npm-workspaces monorepo. The `server/` (Node/TypeScript,
Fastify) serves the built `web/` single-page app and bridges browser clients to
Claude Code over ACP:

```
browser (Lit UI)  --REST + WS-->  server (Fastify, ACP client)  --stdio ACP-->  agent
                                                                                  ├─ prod: claude-code-acp (real)
                                                                                  └─ test/dev: mock-acp
```

The server listens on `0.0.0.0:8099` (matching `ingress_port`), serves
`web/dist` for non-API routes, and spawns the ACP agent via `ACP_AGENT_CMD`
(production: `claude-code-acp`). See [CONTRACT.md](./CONTRACT.md) for the full
internal build contract and type/source-of-truth conventions.

### Add-on packaging

Everything Home Assistant needs lives in [`claude_code/`](./claude_code):

- `config.yaml` — add-on manifest (ingress, panel, options/schema, folder maps).
- `build.yaml` — per-arch Debian base images.
- `Dockerfile` — installs Node 20, `@anthropic-ai/claude-code`, and
  `@zed-industries/claude-code-acp`, then builds the monorepo in-image.
- `rootfs/etc/s6-overlay/...` — an s6 `longrun` service (`claude-server`) that
  reads the options via `bashio` and runs the Fastify server.
- `apparmor.txt`, `translations/en.yaml`, `icon.png`, `logo.png`, `CHANGELOG.md`.

> **Build context note:** the image is built with the **repository root** as the
> Docker context (`docker build -f claude_code/Dockerfile -t claude_code .`), so
> the whole monorepo can be copied in and built. The repo-root `.dockerignore`
> keeps `node_modules`/`dist`/`.git` out of the context. The s6 `run` script is
> made executable by a `chmod +x` step in the `Dockerfile` (git alone can't
> guarantee the executable bit).

## Development

This is a standard npm workspaces monorepo (Node >= 20, ESM, TypeScript 5.6).
The root owns the lockfile — do not run `npm install` inside a package.

```bash
# Install all workspace dependencies (from the repo root)
npm install

# Build shared + server + web
npm run build

# Dev servers
npm run dev:server   # Fastify with tsx watch
npm run dev:web      # Vite dev server

# Type-check / lint
npm run typecheck

# Unit tests (server + web)
npm test

# End-to-end tests (Playwright)
npm run e2e
```

CI runs the Playwright E2E suite against the **mock ACP agent** (`mock-acp`),
which emits a deterministic, scripted ACP stream so screenshots are stable.
Baseline screenshots at mobile (390x844) and desktop (1280x800) viewports are
committed under `e2e/screenshots/`; a visual check fails CI if the UI changes
without updating them.

## License

MIT — see [LICENSE](./LICENSE).
