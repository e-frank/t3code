import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";

type Turn = Pick<
  OrchestrationV2ProviderTurn,
  "providerThreadId" | "ordinal" | "completedAt" | "tokenUsage" | "turnTokenUsage"
>;

/** Smaller contexts cost little to resend. */
const MIN_RESENT_TOKENS = 10_000;

/**
 * Fork: prompt tokens the provider thread's latest finished turn sent again although cached, or
 * null. Uncached prompt tokens in the turn's totals beyond its context growth count as resent, at
 * least half the previous context; a turn without totals is judged by its last request. A context
 * under half the previous one is a new one (compaction), which starts uncached.
 */
export function latestTurnPromptCacheMiss(
  turns: ReadonlyArray<Turn>,
  providerThreadId: Turn["providerThreadId"] | undefined,
): number | null {
  const own = turns
    .filter((turn) => turn.providerThreadId === providerThreadId)
    .toSorted((left, right) => left.ordinal - right.ordinal);
  const latest = own.at(-1);
  const usage = latest?.tokenUsage;
  const previous = own.slice(0, -1).findLast((turn) => (turn.tokenUsage?.usedTokens ?? 0) > 0)
    ?.tokenUsage?.usedTokens;
  if (latest == null || latest.completedAt === null || usage == null || previous == null) {
    return null;
  }
  if (usage.usedTokens < previous / 2) return null;
  const totals = latest.turnTokenUsage;
  const resent =
    totals?.usageStatus === "complete"
      ? totals.inputTokens -
        (totals.cachedInputTokens ?? 0) -
        Math.max(0, usage.usedTokens - previous)
      : (usage.inputTokens ?? 0) - (usage.cachedInputTokens ?? 0);
  return resent >= Math.max(MIN_RESENT_TOKENS, previous / 2) ? resent : null;
}
