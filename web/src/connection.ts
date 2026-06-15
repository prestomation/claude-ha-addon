import type {
  ApiKeyLoginRequest,
  ClientMessage,
  DirsResponse,
  OAuthCompleteRequest,
  OAuthStartResponse,
  ServerMessage,
  SimpleResult,
  StatusResponse,
} from "@addon/shared";

// ---------------------------------------------------------------------------
// Pure URL helpers (unit-tested) — derive ingress-correct, RELATIVE base paths.
// ---------------------------------------------------------------------------

/**
 * Compute the directory portion of an ingress URL from `document.baseURI` (or a
 * location href). Always ends with a trailing slash. e.g.
 *   https://ha.local/api/hassio_ingress/TOKEN/  -> /api/hassio_ingress/TOKEN/
 *   https://ha.local/api/hassio_ingress/TOKEN/index.html -> .../TOKEN/
 */
export function basePath(baseURI: string): string {
  const url = new URL(baseURI);
  let path = url.pathname;
  // Strip a trailing file component (anything after the last slash containing a
  // dot or non-slash filename); keep the directory.
  if (!path.endsWith("/")) {
    path = path.slice(0, path.lastIndexOf("/") + 1);
  }
  if (path === "") path = "/";
  return path;
}

/** Build an absolute REST URL for `api/<endpoint>` honoring the ingress base. */
export function apiUrl(baseURI: string, endpoint: string): string {
  const base = basePath(baseURI);
  const rel = endpoint.replace(/^\/+/, "");
  return `${base}${rel}`;
}

/** Build the ws(s):// URL for the `/ws` endpoint under the ingress base. */
export function wsUrl(locationHref: string, baseURI: string): string {
  const loc = new URL(locationHref);
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const base = basePath(baseURI);
  return `${proto}//${loc.host}${base}ws`;
}

// ---------------------------------------------------------------------------
// Connection: REST + WS wrapper using shared types.
// ---------------------------------------------------------------------------

type ServerMessageHandler = (msg: ServerMessage) => void;
type StatusHandler = (connected: boolean) => void;

export class Connection {
  private ws: WebSocket | null = null;
  private messageHandlers = new Set<ServerMessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 15000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly getBaseURI: () => string = () => document.baseURI,
    private readonly getLocationHref: () => string = () =>
      window.location.href,
  ) {}

  // --- REST ---------------------------------------------------------------

  private async request<T>(
    endpoint: string,
    init?: RequestInit,
  ): Promise<T> {
    const res = await fetch(apiUrl(this.getBaseURI(), endpoint), {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* ignore non-json bodies */
      }
      throw new Error(message);
    }
    return (await res.json()) as T;
  }

  getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("api/status");
  }

  getDirs(): Promise<DirsResponse> {
    return this.request<DirsResponse>("api/dirs");
  }

  loginApiKey(apiKey: string): Promise<SimpleResult> {
    const body: ApiKeyLoginRequest = { apiKey };
    return this.request<SimpleResult>("api/auth/apikey", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  oauthStart(): Promise<OAuthStartResponse> {
    return this.request<OAuthStartResponse>("api/auth/oauth/start", {
      method: "POST",
    });
  }

  oauthComplete(flowId: string, code: string): Promise<SimpleResult> {
    const body: OAuthCompleteRequest = { flowId, code };
    return this.request<SimpleResult>("api/auth/oauth/complete", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  logout(): Promise<SimpleResult> {
    return this.request<SimpleResult>("api/auth/logout", { method: "POST" });
  }

  // --- WebSocket ----------------------------------------------------------

  onMessage(handler: ServerMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  connect(): void {
    this.closed = false;
    this.openSocket();
  }

  private openSocket(): void {
    if (this.ws) return;
    const url = wsUrl(this.getLocationHref(), this.getBaseURI());
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectDelay = 1000;
      this.statusHandlers.forEach((h) => h(true));
    });

    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      this.messageHandlers.forEach((h) => h(msg));
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.statusHandlers.forEach((h) => h(false));
      if (!this.closed) this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close handler performs the reconnect.
      ws.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay,
    );
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
