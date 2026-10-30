import { describe, expect, it } from "vite-plus/test";
import {
  ANTHROPIC_PROMPT_CACHE_TTL_MS,
  formatPromptCacheTimer,
  promptCacheTimer,
} from "./ThreadContextWindow";

const refreshedAt = "2026-10-30T12:00:00.000Z";
const at = (iso: string) => Date.parse(iso);

describe("promptCacheTimer", () => {
  it("counts down a fixed TTL from the last refresh", () => {
    expect(
      promptCacheTimer(refreshedAt, at("2026-10-30T12:10:00.000Z"), ANTHROPIC_PROMPT_CACHE_TTL_MS),
    ).toEqual({ kind: "expiresIn", ms: 50 * 60 * 1000 });
  });

  it("expires once the TTL has passed", () => {
    expect(
      promptCacheTimer(refreshedAt, at("2026-10-30T13:00:00.000Z"), ANTHROPIC_PROMPT_CACHE_TTL_MS),
    ).toEqual({ kind: "expired" });
  });

  it("counts up without a TTL", () => {
    expect(promptCacheTimer(refreshedAt, at("2026-10-30T12:03:20.000Z"), null)).toEqual({
      kind: "since",
      ms: 200_000,
    });
  });

  it("treats a refresh ahead of the local clock as just now", () => {
    expect(promptCacheTimer(refreshedAt, at("2026-10-30T11:59:58.000Z"), null)).toEqual({
      kind: "since",
      ms: 0,
    });
  });

  it("shows nothing for an unreadable timestamp", () => {
    expect(promptCacheTimer("not a date", 0, null)).toBeNull();
  });
});

describe("formatPromptCacheTimer", () => {
  it("formats minutes and seconds, adding hours from an hour on", () => {
    expect(formatPromptCacheTimer(0)).toBe("0:00");
    expect(formatPromptCacheTimer(59_999)).toBe("0:59");
    expect(formatPromptCacheTimer(12 * 60_000 + 34_000)).toBe("12:34");
    expect(formatPromptCacheTimer(3_600_000 + 5 * 60_000 + 7_000)).toBe("1:05:07");
  });
});
