import { describe, expect, it } from "vite-plus/test";
import {
  ANTHROPIC_PROMPT_CACHE_TTL_MS,
  formatPromptCacheTimer,
  promptCacheTimer,
} from "./ThreadContextWindow";

const refreshedAt = "2026-10-30T12:00:00.000Z";
const at = (iso: string) => Date.parse(iso);

describe("promptCacheTimer", () => {
  it("counts up from the last refresh with a fixed TTL", () => {
    expect(
      promptCacheTimer(refreshedAt, at("2026-10-30T12:10:00.000Z"), ANTHROPIC_PROMPT_CACHE_TTL_MS),
    ).toEqual({ ms: 10 * 60 * 1000, state: "fresh" });
  });

  it("warns in the last five minutes of a fixed TTL", () => {
    expect(
      promptCacheTimer(refreshedAt, at("2026-10-30T12:55:00.000Z"), ANTHROPIC_PROMPT_CACHE_TTL_MS),
    ).toEqual({ ms: 55 * 60 * 1000, state: "expiring" });
  });

  it("keeps counting up once the TTL has passed", () => {
    expect(
      promptCacheTimer(refreshedAt, at("2026-10-30T13:02:00.000Z"), ANTHROPIC_PROMPT_CACHE_TTL_MS),
    ).toEqual({ ms: 62 * 60 * 1000, state: "expired" });
  });

  it("counts up without a TTL", () => {
    expect(promptCacheTimer(refreshedAt, at("2026-10-30T12:03:20.000Z"), null)).toEqual({
      ms: 200_000,
      state: "fresh",
    });
  });

  it("treats a refresh ahead of the local clock as just now", () => {
    expect(promptCacheTimer(refreshedAt, at("2026-10-30T11:59:58.000Z"), null)).toEqual({
      ms: 0,
      state: "fresh",
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
