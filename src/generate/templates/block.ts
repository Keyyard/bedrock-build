import { renderJson } from "./serialize.js";
import { VERSIONS } from "../core/versions.js";

/**
 * BP block render function. SPEC §4.6.
 *
 * The 1.21.80 pairing rule: if a block uses `minecraft:material_instances` it
 * MUST also define `minecraft:geometry` (and vice versa). ALWAYS emit both.
 * Default geometry = `"minecraft:geometry.full_block"`. The texture value is
 * the terrain_texture KEY (namespaced), not a path.
 */
export interface BlockTemplateOptions {
  identifier: string;
  /** Namespaced terrain_texture key. */
  atlasKey: string;
  /** opaque | blend | alpha_test. */
  renderMethod: string;
  /** Optional light emission 0–15. */
  light?: number;
}

export function renderBlockJson(opts: BlockTemplateOptions): string {
  const components: Record<string, unknown> = {
    "minecraft:geometry": "minecraft:geometry.full_block",
    "minecraft:material_instances": {
      "*": { texture: opts.atlasKey, render_method: opts.renderMethod },
    },
    "minecraft:destructible_by_mining": { seconds_to_destroy: 1.5 },
    "minecraft:destructible_by_explosion": { explosion_resistance: 3 },
    "minecraft:friction": 0.6,
  };

  if (typeof opts.light === "number" && opts.light > 0) {
    components["minecraft:light_emission"] = opts.light;
  }

  return renderJson({
    format_version: VERSIONS.block,
    "minecraft:block": {
      description: {
        identifier: opts.identifier,
        menu_category: { category: "construction" },
      },
      components,
    },
  });
}
