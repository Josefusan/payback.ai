import type { DataSource } from "../data/api";
import { sourceLabel } from "../data/api";

export interface SourceBadgeProps {
  source: DataSource | null;
  loading: boolean;
  /** Set when the live read failed, shown as a title so the reason is inspectable but not shouted. */
  error?: string | null;
}

/**
 * Where the numbers on this screen came from. The dashboard can run off the IF-01 fixtures when the
 * Worker is unreachable, and that must never be mistaken for live data — so it is always labelled.
 */
export function SourceBadge({ source, loading, error }: SourceBadgeProps) {
  const tone = source === "live" ? "badge--ok" : source === "fixture" ? "badge--warn" : "badge--fixture";
  return (
    <span
      className={`badge ${tone}`}
      data-testid="data-source"
      data-source={source ?? "none"}
      title={error ?? undefined}
    >
      {sourceLabel(source, loading)}
    </span>
  );
}
