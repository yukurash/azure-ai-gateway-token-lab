import { describe, expect, it } from "vitest";
import { SseParser } from "../src/sse.js";
import { parseUsage } from "../src/types.js";

describe("SSE parser", () => {
  it("handles every possible two-chunk split including CRLF boundaries", () => {
    const input = ': keepalive\r\ndata: {"text":"日本語"}\r\n\r\ndata: [DONE]\r\n\r\n';
    for (let split = 0; split <= input.length; split++) {
      const events: string[] = [];
      const parser = new SseParser(data => events.push(data));
      parser.feed(input.slice(0, split));
      parser.feed(input.slice(split), true);
      expect(events).toEqual(['{"text":"日本語"}', "[DONE]"]);
    }
  });
  it("joins data fields and ignores event/id fields", () => {
    const events: string[] = [];
    const parser = new SseParser(data => events.push(data));
    parser.feed("event: message\nid: 1\ndata: first\ndata: second\n\n", true);
    expect(events).toEqual(["first\nsecond"]);
  });
  it("rejects an incomplete final event", () => {
    expect(() => new SseParser(() => {}).feed("data: incomplete\n", true)).toThrow("incomplete");
  });
});

describe("usage parsing", () => {
  it("preserves missing usage instead of converting it to zero", () => {
    expect(parseUsage({ usage: null })).toBeNull();
  });
  it("accepts a complete total", () => {
    expect(parseUsage({ usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }))
      .toEqual({ prompt: 3, completion: 4, total: 7 });
  });
  it.each([
    { prompt_tokens: 3, completion_tokens: 4, total_tokens: 8 },
    { prompt_tokens: -1, completion_tokens: 4, total_tokens: 3 },
    { prompt_tokens: "3", completion_tokens: 4, total_tokens: 7 },
  ])("rejects malformed usage", usage => {
    expect(() => parseUsage({ usage })).toThrow("invalid_usage");
  });
});
