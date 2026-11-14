import { useEffect, useSyncExternalStore } from "react";

/**
 * Fork: remembers each thread's last prompt cache miss. A miss is one request, and the next
 * request's usage replaces it, so the app has to note it as it arrives. Kept for the app
 * session, for threads that were open when it happened.
 */
export interface PromptCacheMiss {
  /** When the request's usage was reported. */
  readonly at: string;
  /** Prompt tokens the request did not read from cache. */
  readonly tokens: number;
}

interface RequestUsage {
  readonly updatedAt: string;
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
}

/** Smaller prompts cost little to resend. */
const MIN_PROMPT_TOKENS = 10_000;

/**
 * Whether `usage` is a request that resent a context the previous one had cached: under half of
 * its prompt came from cache. A prompt under half the previous size is a new context instead
 * (compaction, a cleared thread), which always starts uncached.
 */
function detectPromptCacheMiss(
  previous: RequestUsage,
  usage: RequestUsage,
): PromptCacheMiss | null {
  const prompt = usage.inputTokens;
  if (prompt === undefined || prompt < MIN_PROMPT_TOKENS) return null;
  if (!(Date.parse(usage.updatedAt) > Date.parse(previous.updatedAt))) return null;
  if (prompt < (previous.inputTokens ?? 0) / 2) return null;
  const cached = usage.cachedInputTokens ?? 0;
  return cached < prompt / 2 ? { at: usage.updatedAt, tokens: prompt - cached } : null;
}

const lastUsage = new Map<string, RequestUsage>();
const misses = new Map<string, PromptCacheMiss>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Feed it the open thread's newest request usage; the first one seen only sets the baseline. */
export function usePromptCacheMissTracker(threadKey: string | null, usage: RequestUsage | null) {
  const updatedAt = usage?.updatedAt;
  const inputTokens = usage?.inputTokens;
  const cachedInputTokens = usage?.cachedInputTokens;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- notes the request in a store that outlives this component, since the next request's usage replaces it
  useEffect(() => {
    if (threadKey === null || updatedAt === undefined) return;
    const current = { updatedAt, inputTokens, cachedInputTokens };
    const previous = lastUsage.get(threadKey);
    lastUsage.set(threadKey, current);
    const miss = previous === undefined ? null : detectPromptCacheMiss(previous, current);
    if (miss === null) return;
    misses.set(threadKey, miss);
    for (const listener of listeners) listener();
  }, [threadKey, updatedAt, inputTokens, cachedInputTokens]);
}

export function usePromptCacheMiss(threadKey: string | null): PromptCacheMiss | null {
  return useSyncExternalStore(subscribe, () =>
    threadKey === null ? null : (misses.get(threadKey) ?? null),
  );
}
