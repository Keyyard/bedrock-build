import type { BedrockConfig } from "../config.js";
import type { CreateOptions, GeneratorResult } from "./core/types.js";
import type { Tree } from "./core/tree.js";
import { GenerateError } from "./core/errors.js";
import { validateName } from "./core/identifier.js";
import { deriveNames, stripPng } from "./core/names.js";
import { packRoots } from "./core/paths.js";
import { ensureLanguages, mergeItemTexture, mergeLang } from "./core/registries.js";
import { renderItemJson } from "./templates/item.js";
import { renderWeaponAttachableJson } from "./templates/attachable.js";
import { renderRenderControllerJson } from "./templates/render_controller.js";
import { VERSIONS } from "./core/versions.js";

const DEFAULT_DURABILITY = 1561; // diamond
const DEFAULT_DAMAGE = 7;
const DEFAULT_ENCHANT_VALUE = 10;

/**
 * create:weapon pure planner. SPEC §4.1. Diamond-sword defaults.
 *
 * NEVER emit the deprecated `minecraft:weapon`. Use minecraft:damage (additive
 * over the base 1-damage hand attack), durability, enchantable {slot:"sword"},
 * hand_equipped, max_stack_size 1.
 *
 * 3D additionally emits an attachable + a CUSTOM render controller that
 * REFERENCE user-imported geometry/animation/texture (none generated).
 */
export function planWeapon(
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

  const durability = opts.durability ?? DEFAULT_DURABILITY;
  const damage = opts.damage ?? DEFAULT_DAMAGE;
  const enchantValue = opts.enchantValue ?? DEFAULT_ENCHANT_VALUE;

  // BP item (both modes).
  tree.write(
    `${bpRel}/items/${name}.item.json`,
    renderItemJson({
      formatVersion: VERSIONS.item,
      identifier: n.identifier,
      category: "equipment",
      components: {
        "minecraft:icon": n.atlasKey,
        "minecraft:display_name": { value: n.displayName },
        "minecraft:max_stack_size": 1,
        "minecraft:hand_equipped": true,
        "minecraft:damage": damage,
        "minecraft:durability": { max_durability: durability },
        "minecraft:enchantable": { slot: "sword", value: enchantValue },
      },
    }),
  );

  // Registry + lang side-effects (both modes).
  mergeItemTexture(tree, rpRel, n.atlasKey, `textures/items/${icon}`);
  ensureLanguages(tree, rpRel);
  mergeLang(tree, rpRel, `item.${n.identifier}`, n.displayName);

  const notes: string[] = [`Drop the icon PNG at RP/textures/items/${icon}.png`];

  const mode = (opts.mode ?? "2d").toLowerCase();
  if (mode === "3d") {
    const geometry = (opts.geometry ?? `geometry.${n.namespace}.${name}`).trim();
    const texture = stripPng((opts.texture ?? `textures/${n.namespace}/items/${name}`).trim());
    const rcId = `controller.render.${n.atlasKey}`;

    tree.write(
      `${rpRel}/attachables/${name}.attachable.json`,
      renderWeaponAttachableJson({
        identifier: n.identifier,
        geometry,
        texture,
        renderController: rcId,
        animationPrefix: `animation.${n.namespace}.${name}`,
      }),
    );

    tree.write(
      `${rpRel}/render_controllers/${name}.rc.json`,
      renderRenderControllerJson({ id: rcId }),
    );

    notes.push(
      `3D weapon: import your model into RP/models/entity/, your animations into RP/animations/ (the attachable references "${`animation.${n.namespace}.${name}`}.first_person"/".third_person" — rename there if yours differ), and the texture at ${texture}.png.`,
      `If it doesn't render or animate, adjust the geometry/animation yourself — the generator wires the references, not the art.`,
    );
  }

  return { notes };
}
