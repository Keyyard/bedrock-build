import { renderJson } from "./serialize.js";

/**
 * BP item render function. SPEC §4.1/§4.2/§4.3/§4.4.
 *
 * Shared conventions (§3.6 / §5): `minecraft:icon` is the plain STRING form
 * (the namespaced atlas key), never the object form. The planner supplies the
 * full, ordered component set (so per-family key order matches the spec
 * skeletons); this module owns only the envelope: `format_version`, the
 * description, and the menu_category.
 */
export interface ItemTemplateOptions {
  formatVersion: string;
  identifier: string;
  /** menu_category.category, e.g. "equipment" | "items". */
  category: string;
  /** Full, ordered component map (includes minecraft:icon as a plain string). */
  components: Record<string, unknown>;
}

/** Render a BP item JSON envelope around the planner-supplied components. */
export function renderItemJson(opts: ItemTemplateOptions): string {
  return renderJson({
    format_version: opts.formatVersion,
    "minecraft:item": {
      description: {
        identifier: opts.identifier,
        menu_category: { category: opts.category },
      },
      components: opts.components,
    },
  });
}

/**
 * The shared icon component. SPEC §3.6 convention 1: plain string form, never
 * the object form. One helper so every generator emits it identically.
 */
export function iconComponent(atlasKey: string): string {
  return atlasKey;
}
