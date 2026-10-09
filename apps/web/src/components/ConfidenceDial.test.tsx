import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SweepPoint, ThresholdSetting } from "../../../../packages/contracts/api";
import { ConfidenceDial, formatShape } from "./ConfidenceDial";

const setting = (over: Partial<ThresholdSetting> = {}): ThresholdSetting => ({
  key: "auto_post_threshold",
  value: 0.9,
  updated_by: "Joseph",
  updated_at: "2026-10-09T22:41:58.422Z",
  ...over,
});

/** A sweep whose numbers move with the threshold, so a readout that ignored the slider would fail. */
const sweep: SweepPoint[] = [0.8, 0.9, 0.99].map((threshold) => ({
  threshold,
  coverage: threshold === 0.8 ? 0.99 : threshold === 0.9 ? 0.5 : 0.05,
  auto_precision: threshold === 0.8 ? 0.87 : threshold === 0.9 ? 0.98 : 1,
  review_rate: threshold === 0.8 ? 0.01 : threshold === 0.9 ? 0.5 : 0.95,
  n_labeled: 42,
}));

const renderDial = (over: Partial<Parameters<typeof ConfidenceDial>[0]> = {}) =>
  render(<ConfidenceDial setting={setting()} sweep={sweep} loading={false} error={null} {...over} />);

describe("ConfidenceDial (T-L4-004)", () => {
  it("exposes a formatShape for the AG Studio contract", () => {
    expect(formatShape.id).toBe("confidence-dial");
    expect(formatShape.fields).toHaveProperty("threshold");
    expect(formatShape.fields).toHaveProperty("n_labeled");
  });

  it("shows the stored threshold and who set it", () => {
    renderDial();
    expect(screen.getByTestId("dial-value")).toHaveTextContent("90.0%");
    expect(screen.getByTestId("dial-provenance")).toHaveTextContent("set by Joseph");
  });

  it("says 'never turned' rather than inventing a date when the dial is still the deploy default", () => {
    renderDial({ setting: setting({ updated_by: "deploy default", updated_at: "" }) });
    expect(screen.getByTestId("dial-provenance")).toHaveTextContent("never turned");
  });

  it("reports the sweep at the selected threshold, sample size included", () => {
    renderDial();
    // 0.90 is the stored value, so these are its row of the sweep.
    expect(screen.getByTestId("dial-coverage")).toHaveTextContent("50%");
    expect(screen.getByTestId("dial-precision")).toHaveTextContent("98%");
    expect(screen.getByTestId("dial-n-labeled")).toHaveTextContent("42");
  });

  it("moves the sweep readout when the slider moves, before anything is committed", () => {
    renderDial();
    fireEvent.change(screen.getByTestId("dial-slider"), { target: { value: "0.8" } });
    expect(screen.getByTestId("dial-coverage")).toHaveTextContent("99%");
    expect(screen.getByTestId("dial-precision")).toHaveTextContent("87%");
  });

  it("says the sweep has nothing to measure when nothing has been judged", () => {
    renderDial({ sweep: sweep.map((p) => ({ ...p, n_labeled: 0 })) });
    expect(screen.getByTestId("dial-no-labels")).toBeInTheDocument();
  });

  it("never renders a fabricated dial when the read fails", () => {
    renderDial({ setting: null, sweep: null, error: "GET /api/settings/auto_post_threshold → 500" });
    expect(screen.getByTestId("dial-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("dial-value")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dial-slider")).not.toBeInTheDocument();
  });

  it("will not queue a turn until the value actually changes", () => {
    renderDial();
    expect(screen.getByTestId("dial-set")).toBeDisabled();
    fireEvent.change(screen.getByTestId("dial-slider"), { target: { value: "0.95" } });
    // Still disabled: without the admin token the request could only come back 401.
    expect(screen.getByTestId("dial-set")).toBeDisabled();
    fireEvent.change(screen.getByTestId("dial-token"), { target: { value: "secret" } });
    expect(screen.getByTestId("dial-set")).not.toBeDisabled();
  });
});
