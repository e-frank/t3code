import { TimerIcon } from "lucide-react";

import { useNowSecond } from "~/hooks/useNowSecond";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";

/** Anthropic keeps a prompt cache for an hour after the last request that used it. */
export const ANTHROPIC_PROMPT_CACHE_TTL_MS = 60 * 60 * 1000;
/** The countdown turns to a warning this long before the cache expires. */
const CACHE_EXPIRY_WARNING_MS = 5 * 60 * 1000;

export type PromptCacheTimer =
  | { readonly kind: "expiresIn"; readonly ms: number }
  | { readonly kind: "expired" }
  | { readonly kind: "since"; readonly ms: number };

/**
 * The prompt cache measured from its last refresh (the newest usage report, one per request):
 * time left with a fixed TTL, otherwise time since the refresh.
 */
export function promptCacheTimer(
  refreshedAt: string,
  now: number,
  ttlMs: number | null,
): PromptCacheTimer | null {
  const refreshed = Date.parse(refreshedAt);
  if (Number.isNaN(refreshed)) return null;
  const elapsed = Math.max(0, now - refreshed);
  if (ttlMs === null) return { kind: "since", ms: elapsed };
  return elapsed >= ttlMs ? { kind: "expired" } : { kind: "expiresIn", ms: ttlMs - elapsed };
}

/** `m:ss`, or `h:mm:ss` from an hour on. */
export function formatPromptCacheTimer(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function PromptCacheTimerLabel(props: {
  readonly refreshedAt: string;
  readonly ttlMs: number | null;
}) {
  const timer = promptCacheTimer(props.refreshedAt, useNowSecond(), props.ttlMs);
  if (timer === null) return null;
  // A countdown rounds up, so it reads 0:01 in its last second and expires at 0:00.
  const text =
    timer.kind === "expired"
      ? "expired"
      : timer.kind === "expiresIn"
        ? formatPromptCacheTimer(timer.ms + 999)
        : `${formatPromptCacheTimer(timer.ms)} ago`;
  const title =
    timer.kind === "expired"
      ? "Prompt cache expired: the next message writes it again"
      : timer.kind === "expiresIn"
        ? `Prompt cache expires in ${text}, an hour after the last request`
        : `Prompt cache last refreshed ${text}`;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex min-w-0 items-center gap-0.5 truncate",
        timer.kind === "expired"
          ? "text-destructive"
          : timer.kind === "expiresIn" && timer.ms <= CACHE_EXPIRY_WARNING_MS
            ? "text-warning"
            : "text-muted-foreground",
      )}
    >
      <TimerIcon aria-hidden className="size-3 shrink-0 self-center" />
      <span className="sr-only">Prompt cache: </span>
      {text}
    </span>
  );
}

/**
 * Context use for the thread details panel; upstream's 20% and 10% left thresholds. With `cache`,
 * a prompt cache timer sits between the label and the token count: a countdown for a fixed TTL
 * (`ttlMs`), the time since the last refresh when the TTL varies (`null`).
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
