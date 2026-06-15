# Changelog

## 0.1.0

Initial release.

- Run Claude Code inside Home Assistant, reachable from the sidebar via ingress
  (no exposed ports).
- Mobile-first chat UI that talks to Claude Code over the Agent Client Protocol
  (ACP) — start sessions, stream responses, switch models, toggle plan/auto
  mode, and approve tool permissions. Not a terminal.
- Authentication via Anthropic OAuth (sign in with your Claude account) or an
  API key. Credentials persist on the add-on's `/data` volume.
- Access to your Home Assistant configuration plus the `share`, `media`, `ssl`
  (read-only), and `backup` (read-only) folders.
- Configurable log level and default working directory.
- Multi-arch images for `aarch64` and `amd64`, built on the Home Assistant
  Debian base with Node.js 20.
