import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";

/** Context use for the thread details panel, styled like its usage bars. Red past 90%. */
export function ThreadContextWindow(props: { readonly usage: ContextWindowSnapshot }) {
  const { usedTokens, maxTokens, usedPercentage } = props.usage;
  const percent = Math.max(0, Math.min(100, usedPercentage ?? 0));
  return (
    <div className="flex flex-col gap-1 px-1.5">
      <div className="flex items-baseline justify-between gap-2 text-2xs tabular-nums">
        <span className="font-medium text-xs">Context</span>
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
              percent > 90 ? "bg-destructive" : "bg-muted-foreground/70",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
