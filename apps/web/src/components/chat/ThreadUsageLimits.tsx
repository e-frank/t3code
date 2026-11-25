import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  antigravityWindowLimitsModel,
  elapsedShare,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { formatDuration, limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { useNavigate } from "@tanstack/react-router";

import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ANTHROPIC_PROMPT_CACHE_TTL_MS, ThreadContextWindow } from "./ThreadContextWindow";
import { resolveThreadDetailsLimits } from "./ThreadDetailsUsage.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

type WindowKind = ServerProviderUsageWindow["kind"];

interface UsageAccount {
  readonly key: string;
  readonly name: string;
  readonly limits: ServerProviderUsageLimits;
}

const KIND_ORDER: ReadonlyArray<WindowKind> = ["session", "weekly", "monthly", "other"];
// Always laid out, so weekly sits in the same column for accounts without a session window.
const FIXED_KINDS: ReadonlySet<WindowKind> = new Set(["session", "weekly"]);

const usedPercent = (window: ServerProviderUsageWindow) =>
  Math.round(Math.max(0, Math.min(100, window.usedPercent)));

// "5h 0m" reads as noise for a window length; drop the empty trailing unit.
const shortDuration = (ms: number) => formatDuration(ms).replace(/ 0[hm]$/, "");

// Upstream's ThreadDetailsUsage thresholds: warning at 20% left, error at 10% left.
function usageTone(window: ServerProviderUsageWindow): { text: string; bar: string } {
  const left = remainingPercent(window);
  if (left <= 10) return { text: "text-destructive-foreground", bar: "bg-destructive" };
  if (left <= 20) return { text: "text-warning-foreground", bar: "bg-warning" };
  return { text: "text-success-foreground", bar: "bg-success" };
}

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const pad2 = (value: number) => String(value).padStart(2, "0");

/**
 * The accounts the selected model draws on, as upstream's `ThreadDetailsUsage` resolves them: the
 * hub accounts that serve the model, each under its own name, or the instance's own limits.
 */
function resolveAccounts(
  providerInstanceId: ProviderInstanceId | null,
  model: string | null,
  providers: readonly ServerProvider[],
  sources: UsageLimitSourceSnapshots,
  now: number,
): {
  readonly driver: ServerProvider["driver"];
  readonly accounts: readonly UsageAccount[];
} | null {
  const provider = providers.find((entry) => entry.instanceId === providerInstanceId);
  const resolved = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  if (!provider || !resolved) return null;
  const label = providerClients.get(provider.driver)?.label ?? String(provider.driver);
  if (resolved.kind === "instance") {
    const windows = resolved.limits.windows.filter(
      (window) => provider.driver !== "antigravity" || antigravityWindowLimitsModel(window, model),
    );
    return {
      driver: provider.driver,
      accounts: [
        { key: provider.instanceId, name: label, limits: { ...resolved.limits, windows } },
      ],
    };
  }
  const accounts = new Map<string, UsageAccount>();
  for (const { window, account } of resolved.windows.flatMap((entry) => entry.members)) {
    const known = accounts.get(account.key);
    accounts.set(account.key, {
      key: account.key,
      name: account.displayName ?? account.email ?? label,
      limits: { ...account.limits, windows: [...(known?.limits.windows ?? []), window] },
    });
  }
  return { driver: provider.driver, accounts: [...accounts.values()] };
}

/**
 * One column per window kind any account reports, headed by its length ("5h"). The fixed kinds
 * stay as empty columns (`title: null`) when no account reports them.
 */
function groupColumns(accounts: readonly UsageAccount[]) {
  return KIND_ORDER.flatMap((kind): { kind: WindowKind; title: string | null }[] => {
    const sample = accounts
      .flatMap((account) => account.limits.windows)
      .find((window) => window.kind === kind);
    if (!sample) return FIXED_KINDS.has(kind) ? [{ kind, title: null }] : [];
    const title = sample.windowDurationMins
      ? shortDuration(sample.windowDurationMins * 60_000)
      : sample.label;
    return [{ kind, title }];
  });
}

function AccountName(props: { readonly name: string }) {
  return props.name.includes("@") ? (
    <RedactedSensitiveText
      key={props.name}
      value={props.name}
      ariaLabel="Toggle account label visibility"
      revealTooltip="Click to reveal account"
      hideTooltip="Click to hide account"
      className="max-w-full truncate align-bottom font-sans text-sm leading-normal"
    />
  ) : (
    props.name
  );
}

function CompactWindow(props: {
  readonly window: ServerProviderUsageWindow | undefined;
  readonly title: string;
  readonly now: number;
}) {
  const { window, title, now } = props;
  const used = window ? usedPercent(window) : null;
  const tone = window ? usageTone(window) : null;
  const share = window ? elapsedShare(window, now) : null;
  const resetsAt = new Date(window?.resetsAt ?? Number.NaN);
  const time = `${pad2(resetsAt.getHours())}:${pad2(resetsAt.getMinutes())}`;
  // Resets are at most a week out, so the weekday is enough; a reset later today needs only its time.
  const reset = Number.isNaN(resetsAt.getTime())
    ? null
    : resetsAt.toDateString() === new Date(now).toDateString()
      ? time
      : `${weekdayFormatter.format(resetsAt)} ${time}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-1 text-2xs tabular-nums">
        <span className="shrink-0 text-muted-foreground">{title}</span>
        {reset === null ? null : (
          <span className="min-w-0 truncate text-muted-foreground">
            <span className="sr-only">Resets </span>
            {reset}
          </span>
        )}
        {used === null ? (
          <span className="shrink-0 text-muted-foreground">-</span>
        ) : (
          <span className={cn("shrink-0 font-medium", tone?.text)}>{used}%</span>
        )}
      </div>
      <div className="relative h-1 rounded-full bg-input">
        {used ? (
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", tone?.bar)}
            style={{ width: `${used}%` }}
          />
        ) : null}
        {share === null ? null : (
          <span
            aria-hidden
            className="absolute -inset-y-0.5 w-px -translate-x-1/2 bg-foreground/70"
            style={{ left: `clamp(1px, ${share * 100}%, calc(100% - 1px))` }}
          />
        )}
      </div>
    </div>
  );
}

interface ThreadDetailsForkUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
  /** Prompt tokens the latest turn sent again on a cache miss, null without one. */
  readonly promptCacheMissTokens: number | null;
  /** The cache lifetime the latest request reported, when it reported one. */
  readonly promptCacheTtlMs: number | undefined;
}

/**
 * The thread details "Usage" item in this fork's layout: per account its icon and name over one
 * row of its session and weekly windows. Upstream's `ThreadDetailsUsage.logic` picks the accounts,
 * and a click opens upstream's usage page. Replaces `ThreadDetailsUsage` behind the same setting.
 */
export function ThreadDetailsForkUsage(props: ThreadDetailsForkUsageInput) {
  const { providerInstanceId, model, providers, sources } = props;
  const navigate = useNavigate();
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const resolved = resolveAccounts(providerInstanceId, model, providers, sources, now);
  if (resolved === null || resolved.accounts.length === 0) return null;
  const { driver, accounts } = resolved;
  const label = providerClients.get(driver)?.label ?? String(driver);
  const columns = groupColumns(accounts).slice(0, 2);
  const openUsage = () => void navigate({ to: "/usage" });

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-limits-heading"
      title="Usage limits"
      showHeading={false}
    >
      {/* A div, not a link: account names can hold their own reveal button. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Open usage"
        onClick={openUsage}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openUsage();
        }}
        className="flex cursor-pointer flex-col gap-3 rounded-md px-1.5 py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {accounts.map((account) => {
          const notice = limitsNotice(account.limits);
          return (
            <div key={account.key} className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <ProviderInstanceIcon
                  driverKind={driver}
                  displayName={label}
                  iconClassName="size-3.5"
                />
                <span className="truncate font-medium text-xs">
                  <AccountName name={account.name} />
                </span>
              </div>
              {notice ? (
                <span className="text-2xs text-muted-foreground">{notice}</span>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {columns.map((column) =>
                    column.title === null ? (
                      <div key={column.kind} />
                    ) : (
                      <CompactWindow
                        key={column.kind}
                        title={column.title}
                        window={account.limits.windows.find(
                          (window) => window.kind === column.kind,
                        )}
                        now={now}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ThreadDetailsSection>
  );
}

/**
 * The thread details "Context window" item in this fork's layout: the context bar with the prompt
 * cache timer. Replaces upstream's `ThreadDetailsContext` behind the same "Context window" setting.
 */
export function ThreadDetailsForkContext(props: ThreadDetailsForkUsageInput) {
  const { contextWindow, promptCacheMissTokens, promptCacheTtlMs } = props;
  // Claude reports its cache lifetime; Codex's varies, so it has no expiry colours.
  const driver = props.providers.find(
    (provider) => provider.instanceId === props.providerInstanceId,
  )?.driver;
  const cache =
    driver === "claudeAgent"
      ? { ttlMs: promptCacheTtlMs ?? ANTHROPIC_PROMPT_CACHE_TTL_MS }
      : driver === "codex"
        ? { ttlMs: null }
        : undefined;
  if (!contextWindow) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-window-heading"
      title="Context window"
      showHeading={false}
    >
      <ThreadContextWindow usage={contextWindow} cache={cache} missTokens={promptCacheMissTokens} />
    </ThreadDetailsSection>
  );
}
