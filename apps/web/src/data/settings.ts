/**
 * The autonomy dial's data layer (`GET|PUT /api/settings/auto_post_threshold`, `GET /api/confidence/sweep`).
 *
 * Neither read falls back to a fixture, unlike the ledger, reconcile and P&L loaders. Those show data the
 * user can see is stale. This is different in kind:
 *
 *   - the threshold is the *position of a control*, and showing a fabricated position would have the
 *     operator believe the agent's authority is something it is not;
 *   - the sweep is an analysis of judgements real people actually made; a fixture would dress invented
 *     sample sizes up as evidence.
 *
 * So a failed read yields nothing and the screen says why — the same rule the audit trail follows.
 */
import type { SweepPoint, ThresholdSetting } from "../../../../packages/contracts/api";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${where} must be a finite number`);
  return value;
}

export function parseThreshold(raw: unknown, where = "GET /api/settings/auto_post_threshold"): ThresholdSetting {
  const row = asRecord(raw);
  if (!row) throw new Error(`${where}: expected an object`);
  if (row.key !== "auto_post_threshold") throw new Error(`${where}: unexpected key ${JSON.stringify(row.key)}`);
  const str = (key: string): string => (typeof row[key] === "string" ? (row[key] as string) : "");
  return {
    key: "auto_post_threshold",
    value: finiteNumber(row.value, `${where}: value`),
    updated_by: str("updated_by"),
    updated_at: str("updated_at"),
  };
}

export function parseSweep(raw: unknown, where = "GET /api/confidence/sweep"): SweepPoint[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: expected an array of sweep points`);
  return raw.map((point, index) => {
    const row = asRecord(point);
    if (!row) throw new Error(`${where}: points[${index}] must be an object`);
    return {
      threshold: finiteNumber(row.threshold, `${where}: points[${index}].threshold`),
      coverage: finiteNumber(row.coverage, `${where}: points[${index}].coverage`),
      auto_precision: finiteNumber(row.auto_precision, `${where}: points[${index}].auto_precision`),
      review_rate: finiteNumber(row.review_rate, `${where}: points[${index}].review_rate`),
      n_labeled: finiteNumber(row.n_labeled, `${where}: points[${index}].n_labeled`),
    };
  });
}

/**
 * Where the dial currently points, and what it would mean at the sweep's thresholds.
 *
 * `setting.updated_at` is empty when nobody has turned it — the deploy default is in force. The UI must
 * render that as "never turned" rather than inventing a date.
 */
export function describeThreshold(setting: ThresholdSetting): string {
  return setting.updated_at === "" ? "never turned" : `set by ${setting.updated_by} at ${setting.updated_at}`;
}

/**
 * The sweep point for a threshold, or the nearest one the sweep actually sampled.
 *
 * The sweep steps in hundredths, so a value typed as 0.905 has no point of its own; snapping to the
 * nearest sample is honest, whereas interpolating would invent a measurement nobody took.
 */
export function sweepAt(points: readonly SweepPoint[], threshold: number): SweepPoint | null {
  if (points.length === 0) return null;
  let best = points[0]!;
  for (const point of points) {
    if (Math.abs(point.threshold - threshold) < Math.abs(best.threshold - threshold)) best = point;
  }
  return best;
}
