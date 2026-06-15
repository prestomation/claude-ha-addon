/**
 * Minimal JSON-RPC 2.0 peer over newline-delimited JSON (ndjson).
 *
 * ACP (Agent Client Protocol) frames each JSON-RPC message as a single line of
 * JSON over stdio. This class is transport-agnostic: you provide a `send`
 * callback (writes one framed message) and feed inbound data with `receive`.
 *
 * It is used on both sides of the wire:
 *  - the server acts as the ACP *client* talking to the adapter subprocess;
 *  - the mock agent (and the real adapter) act as the ACP *agent*.
 */

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class RpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/** Handler for an inbound request. Return value becomes the `result`. */
export type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
/** Handler for an inbound notification. */
export type NotificationHandler = (params: unknown) => void | Promise<void>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export interface PeerOptions {
  /** Writes a single framed (newline-terminated) message to the transport. */
  send: (line: string) => void;
  /** Optional logger for protocol-level diagnostics. */
  onError?: (err: Error) => void;
}

export class JsonRpcPeer {
  private readonly send: (line: string) => void;
  private readonly onError?: (err: Error) => void;
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  private readonly pending = new Map<JsonRpcId, Pending>();
  private nextId = 1;
  private buffer = "";

  constructor(opts: PeerOptions) {
    this.send = opts.send;
    this.onError = opts.onError;
  }

  /** Register a handler for an inbound request method. */
  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  /** Register a handler for an inbound notification method. */
  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  /** Send a request and await the response. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.write(msg);
    });
  }

  /** Send a one-way notification. */
  notify(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.write(msg);
  }

  /** Feed raw inbound data (may contain zero or more complete lines). */
  receive(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length === 0) continue;
      this.dispatch(line);
    }
  }

  /** Reject all in-flight requests (e.g. the transport closed). */
  close(reason = "connection closed"): void {
    for (const [, p] of this.pending) {
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private write(msg: object): void {
    this.send(JSON.stringify(msg) + "\n");
  }

  private dispatch(line: string): void {
    let msg: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      this.onError?.(new Error(`invalid JSON-RPC line: ${line}`));
      return;
    }

    // Response to one of our requests.
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const res = msg as JsonRpcResponse;
      const pending = this.pending.get(res.id);
      if (!pending) return;
      this.pending.delete(res.id);
      if (res.error) {
        pending.reject(new RpcError(res.error.code, res.error.message, res.error.data));
      } else {
        pending.resolve(res.result);
      }
      return;
    }

    // Inbound request (has id + method).
    if ("id" in msg && "method" in msg) {
      const req = msg as JsonRpcRequest;
      void this.handleRequest(req);
      return;
    }

    // Inbound notification (method, no id).
    if ("method" in msg) {
      const note = msg as JsonRpcNotification;
      const handler = this.notificationHandlers.get(note.method);
      if (handler) {
        Promise.resolve(handler(note.params)).catch((err) =>
          this.onError?.(err instanceof Error ? err : new Error(String(err))),
        );
      }
      return;
    }
  }

  private async handleRequest(req: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(req.method);
    if (!handler) {
      this.write({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `method not found: ${req.method}` },
      } satisfies JsonRpcResponse);
      return;
    }
    try {
      const result = await handler(req.params);
      this.write({ jsonrpc: "2.0", id: req.id, result } satisfies JsonRpcResponse);
    } catch (err) {
      const e =
        err instanceof RpcError
          ? { code: err.code, message: err.message, data: err.data }
          : { code: -32000, message: err instanceof Error ? err.message : String(err) };
      this.write({ jsonrpc: "2.0", id: req.id, error: e } satisfies JsonRpcResponse);
    }
  }
}
