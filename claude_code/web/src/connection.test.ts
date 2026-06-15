import { describe, it, expect } from "vitest";
import { apiUrl, basePath, wsUrl } from "./connection.js";

describe("connection URL derivation", () => {
  it("derives the ingress base path from a directory baseURI", () => {
    expect(basePath("https://ha.local/api/hassio_ingress/TOKEN/")).toBe(
      "/api/hassio_ingress/TOKEN/",
    );
  });

  it("strips a trailing file component from baseURI", () => {
    expect(
      basePath("https://ha.local/api/hassio_ingress/TOKEN/index.html"),
    ).toBe("/api/hassio_ingress/TOKEN/");
  });

  it("falls back to root for a bare host", () => {
    expect(basePath("https://ha.local/")).toBe("/");
  });

  it("builds api URLs under the ingress base (no leading slash on endpoint)", () => {
    const base = "https://ha.local/api/hassio_ingress/TOKEN/";
    expect(apiUrl(base, "api/status")).toBe(
      "/api/hassio_ingress/TOKEN/api/status",
    );
    // a leading slash on the endpoint must not escape the base
    expect(apiUrl(base, "/api/status")).toBe(
      "/api/hassio_ingress/TOKEN/api/status",
    );
  });

  it("builds a ws:// URL under the ingress base", () => {
    const base = "http://ha.local:8123/api/hassio_ingress/TOKEN/";
    expect(wsUrl("http://ha.local:8123/whatever", base)).toBe(
      "ws://ha.local:8123/api/hassio_ingress/TOKEN/ws",
    );
  });

  it("uses wss:// when the page is served over https", () => {
    const base = "https://ha.local/api/hassio_ingress/TOKEN/";
    expect(wsUrl("https://ha.local/page", base)).toBe(
      "wss://ha.local/api/hassio_ingress/TOKEN/ws",
    );
  });
});
