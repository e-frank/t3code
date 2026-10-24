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
import { useState } from "react";

import { cn } from "~/lib/utils";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { accountLabel } from "./ComposerUsageLimits";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

type UsageAccount = NonNullable<ReturnType<typeof collectProviderUsageLimits>>["accounts"][number];
type WindowKind = ServerProviderUsageWindow["kind"];

const KIND_ORDER: ReadonlyArray<WindowKind> = ["session", "weekly", "monthly", "other"];

const usedPercent = (window: ServerProviderUsageWindow) =>
  Math.round(Math.max(0, Math.min(100, window.usedPercent)));

// "5h 0m" reads as noise for a window length; drop the empty trailing unit.
const shortDuration = (ms: number) => formatDuration(ms).replace(/ 0[hm]$/, "");

function usageTone(used: number): { text: string; bar: string } {
  if (used < 75) return { text: "text-success-foreground", bar: "bg-success" };
  if (used < 90) return { text: "text-warning-foreground", bar: "bg-warning" };
  return { text: "text-destructive-foreground", bar: "bg-destructive" };
}

const DAY_MS = 86_400_000;

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const pad2 = (value: number) => String(value).padStart(2, "0");

/**
 * Fixed European style, "Sat 23:20" or "Thu 29.10. 09:00": the host locale can be en-US even on a
 * German setup, which would give AM/PM and month-first dates. The date is added once the weekday
 * alone is ambiguous.
 */
function resetLabel(resetsAt: number, now: number): string {
  const date = new Date(resetsAt);
  const day =
    resetsAt - now >= DAY_MS ? ` ${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.` : "";
  return `${weekdayFormatter.format(date)}${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

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

/** Hub accounts are keyed `<source>:<auth file>`; the file name is the account's name. */
function accountName(account: UsageAccount): string {
  if (account.sourceLabel === undefined) return accountLabel(account);
  return account.id.slice(account.id.indexOf(":") + 1).replace(/\.json$/, "");
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

/** One column per window kind any account in the group reports, headed by its length ("5h"). */
function groupColumns(accounts: readonly UsageAccount[]) {
  return KIND_ORDER.flatMap((kind) => {
    const sample = accounts
      .flatMap((account) => account.limits.windows)
      .find((window) => window.kind === kind);
    if (!sample) return [];
    const title = sample.windowDurationMins
      ? shortDuration(sample.windowDurationMins * 60_000)
      : sample.label;
    return [{ kind, title }];
  });
}

function WindowCell(props: {
  readonly window: ServerProviderUsageWindow | undefined;
  readonly now: number;
}) {
  const { window, now } = props;
  if (!window) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">— unavailable</span>
        <div className="h-1.5 rounded-full bg-muted" />
      </div>
    );
  }
  const used = usedPercent(window);
  const tone = usageTone(used);
  const share = elapsedShare(window, now);
  const resetsAt = window.resetsAt === undefined ? null : Date.parse(window.resetsAt);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={cn("font-semibold text-sm tabular-nums", tone.text)}>{used}%</span>
        {resetsAt === null || Number.isNaN(resetsAt) ? null : (
          <span className="truncate text-muted-foreground text-xs tabular-nums">
            {formatDuration(resetsAt - now)} → {resetLabel(resetsAt, now)}
          </span>
        )}
      </div>
      <div
        role="img"
        aria-label={`${window.label}: ${used}% used`}
        className="relative h-1.5 rounded-full bg-muted"
      >
        {used > 0 ? (
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", tone.bar)}
            style={{ width: `${used}%` }}
          />
        ) : null}
        {share === null ? null : (
          // Even-pace mark: usage left of it is under pace, right of it ahead.
          <span
            aria-hidden
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `clamp(1px, ${share * 100}%, calc(100% - 1px))` }}
          />
        )}
      </div>
    </div>
  );
}

function ProviderGroup(props: {
  readonly accounts: readonly UsageAccount[];
  readonly now: number;
}) {
  const { accounts, now } = props;
  const driver = accounts[0]!.driver;
  const label = providerClients.get(driver)?.label ?? String(driver);
  const columns = groupColumns(accounts);
  const gridStyle = {
    gridTemplateColumns: `minmax(9rem, 1.1fr) repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`,
  };
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ProviderInstanceIcon driverKind={driver} displayName={label} iconClassName="size-4" />
        <span className="font-semibold text-sm">{label}</span>
        <Badge variant="secondary" size="sm">
          {accounts.length}
        </Badge>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div
          className="grid gap-x-6 bg-muted/40 px-4 py-2 font-medium text-2xs text-muted-foreground uppercase tracking-wide"
          style={gridStyle}
        >
          <span>Subscription</span>
          {columns.map((column) => (
            <span key={column.kind}>{column.title}</span>
          ))}
        </div>
        {accounts.map((account) => {
          const notice = limitsNotice(account.limits);
          return (
            <div
              key={`${account.driver}:${account.id}`}
              className="grid items-center gap-x-6 border-t px-4 py-3"
              style={gridStyle}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <ProviderInstanceIcon
                  driverKind={account.driver}
                  displayName={label}
                  iconClassName="size-4"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-foreground text-sm">
                    <AccountName name={accountName(account)} />
                  </span>
                  {account.plan ? (
                    <span className="truncate text-muted-foreground text-xs">{account.plan}</span>
                  ) : null}
                </div>
              </div>
              {notice ? (
                <span
                  className="text-muted-foreground text-xs"
                  style={{ gridColumn: `span ${Math.max(columns.length, 1)}` }}
                >
                  {notice}
                </span>
              ) : (
                columns.map((column) => (
                  <WindowCell
                    key={column.kind}
                    window={account.limits.windows.find((window) => window.kind === column.kind)}
                    now={now}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Usage across providers behind an icon, so the composer stays quiet. Accounts are only
 * collected while the dialog is open, and `now` is taken on open, so nothing ticks while closed.
 */
export function ComposerUsageMeter(props: {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
}) {
  const { providerInstanceId, providers, sources } = props;
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const accounts = open ? collectAllUsageAccounts(providerInstanceId, providers, sources, now) : [];
  const groups = new Map<ServerProvider["driver"], UsageAccount[]>();
  for (const account of accounts) {
    groups.set(account.driver, [...(groups.get(account.driver) ?? []), account]);
  }

  return (
    <>
      <Button
        size="xs"
        variant="ghost-muted"
        aria-label="Usage limits"
        onClick={() => {
          setNow(Date.now());
          setOpen(true);
        }}
      >
        <GaugeIcon aria-hidden="true" className="text-muted-foreground" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Usage limits</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-6 pb-2">
              {groups.size === 0 ? (
                <span className="text-muted-foreground text-sm">
                  No provider reports usage limits.
                </span>
              ) : null}
              {[...groups.values()].map((group) => (
                <ProviderGroup key={group[0]!.driver} accounts={group} now={now} />
              ))}
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

type CurrentUsage = { readonly driver: string; readonly account: string | null };

/**
 * What the selected model draws on. Codex and Claude route through the proxy, so only their
 * provider is known. A Pi model's slug prefix names the provider (`anthropic-2/…`), and pi-ef's
 * subscription label at the end of its name (`Claude Opus 5.5 (claude-team)`) names the account.
 */
function currentUsage(
  providers: readonly ServerProvider[],
  instanceId: ProviderInstanceId | null,
  model: string | null,
): CurrentUsage | null {
  const provider = providers.find((entry) => entry.instanceId === instanceId);
  if (!provider) return null;
  if (String(provider.driver) !== "pi") return { driver: String(provider.driver), account: null };
  const prefix = model?.slice(0, Math.max(0, model.indexOf("/"))) ?? "";
  const driver = prefix.startsWith("anthropic")
    ? "claudeAgent"
    : prefix.startsWith("openai-codex")
      ? "codex"
      : null;
  if (driver === null) return null;
  const name = provider.models.find((entry) => entry.slug === model)?.name;
  return { driver, account: name?.match(/\(([^()]+)\)$/)?.[1] ?? null };
}

function CompactWindow(props: {
  readonly window: ServerProviderUsageWindow | undefined;
  readonly title: string;
  readonly now: number;
}) {
  const { window, title, now } = props;
  const used = window ? usedPercent(window) : null;
  const tone = used === null ? null : usageTone(used);
  const share = window ? elapsedShare(window, now) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-1 text-2xs tabular-nums">
        <span className="text-muted-foreground">{title}</span>
        {used === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn("font-medium", tone?.text)}>{used}%</span>
        )}
      </div>
      <div className="relative h-1 rounded-full bg-muted">
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

/**
 * Compact usage for the thread details panel: every provider's accounts, with the one the
 * selected model draws on marked. Pace is measured at the newest reading rather than the wall
 * clock, so the panel only changes when provider or hub data does.
 */
export function ThreadUsageLimits(props: {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
}) {
  const { providerInstanceId, model, providers, sources } = props;
  const now = Math.max(
    0,
    ...providers.map((provider) => Date.parse(provider.usageLimits?.checkedAt ?? "") || 0),
    ...sources.flatMap((source) =>
      source.accounts.map((account) => Date.parse(account.usageLimits.checkedAt) || 0),
    ),
  );
  const accounts = collectAllUsageAccounts(null, providers, sources, now);
  if (accounts.length === 0) return null;
  const current = currentUsage(providers, providerInstanceId, model);
  const groups = new Map<ServerProvider["driver"], UsageAccount[]>();
  for (const account of accounts) {
    groups.set(account.driver, [...(groups.get(account.driver) ?? []), account]);
  }

  return (
    <div className="flex flex-col gap-3 px-1.5">
      {[...groups.values()].map((group) => {
        const driver = group[0]!.driver;
        const label = providerClients.get(driver)?.label ?? String(driver);
        const columns = groupColumns(group).slice(0, 2);
        const isCurrentDriver = current?.driver === String(driver);
        const markedAccount =
          isCurrentDriver && current.account !== null
            ? group.find((account) => accountName(account) === current.account)
            : undefined;
        return (
          <div key={driver} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <ProviderInstanceIcon
                driverKind={driver}
                displayName={label}
                iconClassName="size-3.5"
              />
              <span className="font-medium text-xs">{label}</span>
              {isCurrentDriver && !markedAccount ? (
                <Badge variant="info" size="sm">
                  active
                </Badge>
              ) : null}
            </div>
            {group.map((account) => {
              const notice = limitsNotice(account.limits);
              return (
                <div key={account.id} className="flex min-w-0 flex-col gap-1 ps-5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-muted-foreground text-xs">
                      <AccountName name={accountName(account)} />
                    </span>
                    {account === markedAccount ? (
                      <Badge variant="info" size="sm">
                        active
                      </Badge>
                    ) : null}
                  </div>
                  {notice ? (
                    <span className="text-2xs text-muted-foreground">{notice}</span>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {columns.map((column) => (
                        <CompactWindow
                          key={column.kind}
                          title={column.title}
                          window={account.limits.windows.find(
                            (window) => window.kind === column.kind,
                          )}
                          now={now}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
