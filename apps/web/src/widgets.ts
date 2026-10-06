/**
 * AG Studio custom-widget metadata (T-L4-003).
 *
 * The sponsor brief (`.claude/skills/sponsor-tools/SKILL.md`, `ag-grid-studio.md`) requires every
 * custom widget to expose a `formatShape`: a JSON-shape description so Studio's AI agents can read
 * and configure the widget. `ag-studio-react` needs a commercial licence (docs/decisions.md Q3 —
 * activate on/after Oct 31), so registering widgets via `createWidgets({ additionalTypes })` is a
 * later step. These definitions are the registration-ready metadata; they add no dependency.
 */

/** Mirrors AG Studio's `AgWidgetDefinition.formatShape` (JSON-shape description of the widget data). */
export interface FormatShape {
  /** stable widget id, e.g. "reconciliation-tile". */
  id: string;
  /** human name shown in the Studio widget menu. */
  name: string;
  /** one line answering what the widget shows. */
  description: string;
  /** the fields the widget consumes: field name → JSON-shape type description. */
  fields: Record<string, string>;
}

/** The subset of AG Studio's `AgWidgetDefinition` these widgets ship today (comp registers at G4). */
export interface AgWidgetDefinition {
  id: string;
  /** component name registered with the Studio widget registry once the licence lands. */
  comp: string;
  /** the fields the widget reads from Studio's data model. */
  dataMapping: string[];
  /** the props a Studio user can configure on the widget. */
  form: string[];
  formatShape: FormatShape;
}
