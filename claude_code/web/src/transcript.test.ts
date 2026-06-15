import { describe, it, expect } from "vitest";
import { appendItem, updateItem } from "./transcript.js";
import type { TranscriptItem } from "@addon/shared";

describe("transcript reducer", () => {
  it("appends an item", () => {
    const a: TranscriptItem = {
      id: "1",
      role: "user",
      kind: "text",
      text: "hi",
    };
    const result = appendItem([], a);
    expect(result).toEqual([a]);
  });

  it("replaces an existing item with the same id on append", () => {
    const a: TranscriptItem = {
      id: "1",
      role: "user",
      kind: "text",
      text: "hi",
    };
    const b: TranscriptItem = {
      id: "1",
      role: "user",
      kind: "text",
      text: "updated",
    };
    const result = appendItem([a], b);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(b);
  });

  it("applies a transcript_update patch by itemId", () => {
    const tool: TranscriptItem = {
      id: "t1",
      role: "assistant",
      kind: "tool_call",
      toolCallId: "x",
      title: "Reading file",
      status: "pending",
    };
    const items = appendItem([], tool);
    const updated = updateItem(items, "t1", { status: "completed" });
    const item = updated[0];
    expect(item.kind).toBe("tool_call");
    if (item.kind === "tool_call") {
      expect(item.status).toBe("completed");
      expect(item.title).toBe("Reading file");
    }
    expect(item.id).toBe("t1");
  });

  it("ignores updates for unknown ids", () => {
    const a: TranscriptItem = {
      id: "1",
      role: "user",
      kind: "text",
      text: "hi",
    };
    const items = [a];
    expect(updateItem(items, "nope", { text: "x" } as Partial<TranscriptItem>)).toBe(
      items,
    );
  });
});
