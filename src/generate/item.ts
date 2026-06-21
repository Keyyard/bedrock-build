import type { BedrockConfig } from "../config.js";
import type { CreateOptions, GeneratorResult } from "./core/types.js";
import type { Tree } from "./core/tree.js";
import { GenerateError } from "./core/errors.js";
import { validateName } from "./core/identifier.js";
import { deriveNames, stripPng } from "./core/names.js";
import { packRoots } from "./core/paths.js";
import { ensureLanguages, mergeItemTexture, mergeLang } from "./core/registries.js";
import { renderItemJson } from "./templates/item.js";
import { VERSIONS } from "./core/versions.js";

/**
 * create:item pure planner. SPEC §4.4. Generic 64-stack item.
 *
 * Side-effects: item_texture key `<ns>_<name> → textures/items/<icon>`,
 * `item.<ns>:<name>=<Display>` lang line.
 */
export function planItem(
  tree: Tree,
  config: BedrockConfig,
  opts: CreateOptions,
): GeneratorResult {
  const name = (opts.name ?? "").trim();
  const check = validateName(name);
  if (check !== true) throw new GenerateError(check);

  const n = deriveNames(config.namespace, name, opts.displayName);
  const { bpRel, rpRel } = packRoots(config);
  const icon = stripPng((opts.icon ?? name).trim());

  // BP item.
  tree.write(
    `${bpRel}/items/${name}.item.json`,
    renderItemJson({
      formatVersion: VERSIONS.item,
      identifier: n.identifier,
      category: "items",
      components: {
        "minecraft:icon": n.atlasKey,
        "minecraft:display_name": { value: n.displayName },
        "minecraft:max_stack_size": 64,
      },
    }),
  );

  // Registry + lang side-effects.
  mergeItemTexture(tree, rpRel, n.atlasKey, `textures/items/${icon}`);
  ensureLanguages(tree, rpRel);
  mergeLang(tree, rpRel, `item.${n.identifier}`, n.displayName);

  return {
    notes: [`Drop the icon PNG at RP/textures/items/${icon}.png`],
  };
}
