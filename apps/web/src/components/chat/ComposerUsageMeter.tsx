import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectProviderUsageLimits,
  elapsedShare,
  formatDuration,
  limitsNotice,
} from "@t3tools/shared/usageLimits";
import { GaugeIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { barColor } from "../usage/UsageLimits";
import { AccountSummary } from "./ComposerUsageLimits";
import { composerFloatingLayerProps } from "./composerEventScope";

const usedPercent = (window: ServerProviderUsageWindow) =>
  Math.round(Math.max(0, Math.min(100, window.usedPercent)));

// "5h 0m" reads as noise for a window length; drop the empty trailing unit.
const shortDuration = (ms: number) => formatDuration(ms).replace(/ 0[hm]$/, "");

/** Time spent in the window so far, counting up toward its full length. */
function elapsedLabel(window: ServerProviderUsageWindow, now: number): string | null {
  const share = elapsedShare(window, now);
  if (share === null || window.windowDurationMins === undefined) return null;
  const length = window.windowDurationMins * 60_000;
  return `${shortDuration(share * length)} / ${shortDuration(length)}`;
}

function UsageWindowRows(props: {
  readonly driver: ServerProvider["driver"];
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly now: number;
}) {
  const color = barColor(props.driver);
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] items-center gap-x-3 gap-y-1.5">
      {props.windows.map((window) => {
        const used = usedPercent(window);
        const share = elapsedShare(window, props.now);
        return (
          <Fragment key={window.id}>
            <span className="flex min-w-0 items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{window.label}</span>
              <span className="ms-auto shrink-0 font-medium text-foreground tabular-nums">
                {used}% used
              </span>
            </span>
            <div
              role="img"
              aria-label={`${window.label}: ${used}% used`}
              className="relative h-1.5 rounded-full bg-muted"
            >
              {used > 0 ? (
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${used}%`, backgroundColor: color }}
                />
              ) : null}
              {share === null ? null : (
                // Even-pace mark: usage left of it is under pace, right of it ahead.
                <span
                  aria-hidden
                  className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
                  style={{ left: `clamp(1px, ${share * 100}%, calc(100% - 1px))` }}
                />
              )}
            </div>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {elapsedLabel(window, props.now) ?? ""}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

type UsageAccount = NonNullable<ReturnType<typeof collectProviderUsageLimits>>["accounts"][number];

/**
 * Every account with usage limits, one report per driver, the selected provider's driver first
 * and the selected instance first within it. Drivers without limits (such as Pi) are skipped.
 */
function collectAllUsageAccounts(
  selectedId: ProviderInstanceId | null,
  providers: readonly ServerProvider[],
  sources: UsageLimitSourceSnapshots,
  now: number,
): UsageAccount[] {
  const selected = providers.find((provider) => provider.instanceId === selectedId);
  const ordered = selected
    ? [selected, ...providers.filter((provider) => provider !== selected)]
    : providers;
  const done = new Set<ServerProvider["driver"]>();
  const accounts: UsageAccount[] = [];
  for (const provider of ordered) {
    if (!provider.enabled || done.has(provider.driver)) continue;
    const report = collectProviderUsageLimits(provider.instanceId, providers, sources, now);
    if (report === null || report.accounts.length === 0) continue;
    done.add(provider.driver);
    // With CLIProxyAPI accounts present the CLI's own block is either a copy of one of them
    // (a leftover native login) or the proxy key itself, so only the proxy accounts are shown.
    const proxied = report.accounts.filter((account) => account.sourceLabel !== undefined);
    accounts.push(
      ...[...(proxied.length > 0 ? proxied : report.accounts)].sort(
        (left, right) =>
          Number(right.instanceId === selectedId) - Number(left.instanceId === selectedId),
      ),
    );
  }
  return accounts;
}

/**
 * Usage across providers, behind an icon so the composer stays quiet; clicking it lists every
 * provider's accounts. `now` only advances when the popover opens, so nothing ticks while closed.
 */
export function ComposerUsageMeter(props: {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
}) {
  const { providerInstanceId, providers, sources } = props;
  const [now, setNow] = useState(() => Date.now());
  const accounts = collectAllUsageAccounts(providerInstanceId, providers, sources, now);

  return (
    <Popover onOpenChange={(open) => open && setNow(Date.now())}>
      <PopoverTrigger
        render={
          <Button size="xs" variant="ghost-muted" aria-label="Usage limits">
            <GaugeIcon aria-hidden="true" className="text-muted-foreground" />
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        padding="none"
        width="lg"
        className="text-left whitespace-normal"
      >
        <div className="flex flex-col gap-3 p-(--floating-content-inset)">
          {accounts.length === 0 ? (
            <span className="text-secondary-label text-2xs">No provider reports usage limits.</span>
          ) : null}
          {accounts.map((account) => {
            const notice = limitsNotice(account.limits);
            return (
              <div
                key={`${account.driver}:${account.id}`}
                className="flex min-w-0 flex-col gap-1.5"
              >
                <span className="truncate font-medium text-foreground text-xs">
                  <AccountSummary account={account} />
                </span>
                {notice ? (
                  <span className="text-secondary-label text-2xs">{notice}</span>
                ) : (
                  <UsageWindowRows
                    driver={account.driver}
                    windows={account.limits.windows}
                    now={now}
                  />
                )}
              </div>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
