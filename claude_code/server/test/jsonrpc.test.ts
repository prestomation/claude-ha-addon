import { describe, it, expect } from "vitest";
import { JsonRpcPeer } from "@addon/shared";

/** Wire two peers directly to each other for an in-memory round trip. */
function connect(): [JsonRpcPeer, JsonRpcPeer] {
  let a!: JsonRpcPeer;
  let b!: JsonRpcPeer;
  a = new JsonRpcPeer({ send: (line) => b.receive(line) });
  b = new JsonRpcPeer({ send: (line) => a.receive(line) });
  return [a, b];
}

describe("JsonRpcPeer", () => {
  it("handles request/response", async () => {
    const [a, b] = connect();
    b.onRequest("add", (params) => {
      const { x, y } = params as { x: number; y: number };
      return x + y;
    });
    const result = await a.request<number>("add", { x: 2, y: 3 });
    expect(result).toBe(5);
  });

  it("propagates errors as rejections", async () => {
    const [a, b] = connect();
    b.onRequest("boom", () => {
      throw new Error("nope");
    });
    await expect(a.request("boom")).rejects.toThrow("nope");
  });

  it("delivers notifications", async () => {
    const [a, b] = connect();
    const received: unknown[] = [];
    b.onNotification("event", (p) => received.push(p));
    a.notify("event", { hello: "world" });
    await Promise.resolve();
    expect(received).toEqual([{ hello: "world" }]);
  });

  it("buffers partial lines", async () => {
    const seen: string[] = [];
    const peer = new JsonRpcPeer({ send: () => {} });
    peer.onNotification("m", (p) => seen.push((p as { v: string }).v));
    peer.receive('{"jsonrpc":"2.0","method":"m","params":{"v":"a"}}\n{"jsonrpc":"2.0","met');
    peer.receive('hod":"m","params":{"v":"b"}}\n');
    expect(seen).toEqual(["a", "b"]);
  });
});
