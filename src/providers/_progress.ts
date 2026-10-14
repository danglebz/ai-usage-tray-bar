import type { UsageWindow } from "../types.ts";
import { win } from "./_util.ts";

const count = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A local monthly target, never a provider's purchased credit balance or quota. */
export function monthlyProgress(
  label: string,
  used: number | null,
  configuredTarget: unknown,
  format: (value: number) => string = count,
): UsageWindow {
  const target =
    typeof configuredTarget === "number" || typeof configuredTarget === "string" ? Number(configuredTarget) : NaN;
  const hasTarget = Number.isFinite(target) && target > 0;
  const hasUsage = used !== null && Number.isFinite(used) && used >= 0;
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  return win(
    hasTarget ? `${label} (local target)` : label,
    hasUsage && hasTarget ? (used / target) * 100 : null,
    reset,
    {
      detail: !hasUsage
        ? `Usage not reported${hasTarget ? ` · Target ${format(target)}` : ""}`
        : hasTarget
          ? `${format(used)} / ${format(target)} · ${format(Math.max(0, target - used))} left`
          : `${format(used)} used · Set a monthly target in Settings for %`,
    },
  );
}
