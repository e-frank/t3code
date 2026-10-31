import { TimerIcon } from "lucide-react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Anthropic keeps a prompt cache for an hour after the last request that used it. */
export const ANTHROPIC_PROMPT_CACHE_TTL_MS = 60 * 60 * 1000;
/** The timer turns to a warning this long before a fixed-TTL cache expires. */
const CACHE_EXPIRY_WARNING_MS = 5 * 60 * 1000;

export type PromptCacheState = "fresh" | "expiring" | "expired";

export interface PromptCacheTimer {
  /** Time since the last refresh; the timer always counts up. */
  readonly ms: number;
  /** Where a fixed TTL stands; always `fresh` without one. */
  readonly state: PromptCacheState;
}

/**
 * The prompt cache measured from its last refresh (the newest usage report, one per request): time
 * since the refresh, and with a fixed TTL whether the cache is about to expire or has expired.
 */
export function promptCacheTimer(
  refreshedAt: string,
  now: number,
  ttlMs: number | null,
): PromptCacheTimer | null {
  const refreshed = Date.parse(refreshedAt);
  if (Number.isNaN(refreshed)) return null;
  const ms = Math.max(0, now - refreshed);
  const state: PromptCacheState =
    ttlMs === null
      ? "fresh"
      : ms >= ttlMs
        ? "expired"
        : ttlMs - ms <= CACHE_EXPIRY_WARNING_MS
          ? "expiring"
          : "fresh";
  return { ms, state };
}

/** Whole minutes: `<1m`, `12m`, or `1h 5m` from an hour on. */
export function formatPromptCacheTimer(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes === 0) return "<1m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function PromptCacheTimerLabel(props: {
  readonly refreshedAt: string;
  readonly ttlMs: number | null;
}) {
  const nowMinute = useNowMinute();
  const timer = promptCacheTimer(props.refreshedAt, Date.parse(`${nowMinute}:00Z`), props.ttlMs);
  if (timer === null) return null;
  const text = `${formatPromptCacheTimer(timer.ms)} ago`;
  const title =
    props.ttlMs === null
      ? `Prompt cache last refreshed ${text}`
      : timer.state === "expired"
        ? `Prompt cache last refreshed ${text} and expired: the next message writes it again`
        : `Prompt cache last refreshed ${text}; it expires an hour after the last request`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex min-w-0 items-center gap-0.5 truncate",
              timer.state === "expired"
                ? "text-destructive"
                : timer.state === "expiring"
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          />
        }
      >
        <TimerIcon aria-hidden className="size-3 shrink-0 self-center" />
        <span className="sr-only">Prompt cache: </span>
        {text}
      </TooltipTrigger>
      <TooltipPopup>{title}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Context use for the thread details panel; upstream's 20% and 10% left thresholds. With `cache`,
 * a prompt cache timer sits between the label and the token count, counting up from the last
 * refresh. A fixed TTL (`ttlMs`) colours it as the cache nears and passes expiry; `null` when the
 * TTL varies.
 */
export function ThreadContextWindow(props: {
  readonly usage: ContextWindowSnapshot;
  readonly cache?: { readonly ttlMs: number | null } | undefined;
}) {
  const { usedTokens, maxTokens, usedPercentage, updatedAt } = props.usage;
  const percent = Math.max(0, Math.min(100, usedPercentage ?? 0));
  const left = Math.round(100 - percent);
  return (
    <div className="flex flex-col gap-1 px-1.5">
      <div className="flex items-baseline justify-between gap-2 text-2xs tabular-nums">
        <span className="font-medium text-xs">Context</span>
        {props.cache ? (
          <PromptCacheTimerLabel refreshedAt={updatedAt} ttlMs={props.cache.ttlMs} />
        ) : null}
        <span className="text-muted-foreground">
          {formatContextWindowTokens(usedTokens)}
          {maxTokens == null ? null : ` / ${formatContextWindowTokens(maxTokens)}`}
        </span>
      </div>
      {maxTokens == null ? null : (
        <div
          role="progressbar"
          aria-label="Context window usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-1 overflow-hidden rounded-full bg-input"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
              left <= 10 ? "bg-destructive" : left <= 20 ? "bg-warning" : "bg-muted-foreground/70",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
