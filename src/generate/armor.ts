import type { BedrockConfig } from "../config.js";
import type { CreateOptions, GeneratorResult } from "./core/types.js";
import type { Tree } from "./core/tree.js";
import { GenerateError } from "./core/errors.js";
import { validateName } from "./core/identifier.js";
import { deriveNames, stripPng } from "./core/names.js";
import { packRoots } from "./core/paths.js";
import { ensureLanguages, mergeItemTexture, mergeLang } from "./core/registries.js";
import { renderItemJson } from "./templates/item.js";
import { renderArmorAttachableJson } from "./templates/attachable.js";
import { renderRenderControllerJson } from "./templates/render_controller.js";
import { VERSIONS } from "./core/versions.js";

/** Armor pieces. SPEC §4.3. NOTE the chest enchant slot is `armor_torso`, not `armor_chest`. */
export type ArmorPiece = "helmet" | "chestplate" | "leggings" | "boots";

interface PieceRow {
  wearableSlot: string;
  enchantSlot: string;
  defaultDurability: number;
  defaultProtection: number;
}

const PIECES: Record<ArmorPiece, PieceRow> = {
  helmet: {
    wearableSlot: "slot.armor.head",
    enchantSlot: "armor_head",
    defaultDurability: 265,
    defaultProtection: 2,
  },
  chestplate: {
    wearableSlot: "slot.armor.chest",
    enchantSlot: "armor_torso", // the #1 correctness bug — NOT armor_chest
    defaultDurability: 340,
    defaultProtection: 6,
  },
  leggings: {
    wearableSlot: "slot.armor.legs",
    enchantSlot: "armor_legs",
    defaultDurability: 325,
    defaultProtection: 5,
  },
  boots: {
    wearableSlot: "slot.armor.feet",
    enchantSlot: "armor_feet",
    defaultDurability: 295,
    defaultProtection: 2,
  },
};

const ENCHANT_VALUE = 9;
const DEFAULT_REPAIR_ITEM = "minecraft:diamond";

function isPiece(v: string): v is ArmorPiece {
  return v === "helmet" || v === "chestplate" || v === "leggings" || v === "boots";
}

/**
 * create:armor pure planner. SPEC §4.3. icon mode emits the BP item only; 3d
 * mode additionally emits an attachable + custom render controller referencing
 * user-imported geometry/texture (none generated).
 */
export function planArmor(
  tree: Tree,
  config: BedrockConfig,
  opts: CreateOptions,
): GeneratorResult {
  const name = (opts.name ?? "").trim();
  const check = validateName(name);
  if (check !== true) throw new GenerateError(check);

  const pieceRaw = (opts.piece ?? "chestplate").toLowerCase();
  if (!isPiece(pieceRaw)) {
    throw new GenerateError(
      `Unknown armor piece "${pieceRaw}". Use one of: helmet, chestplate, leggings, boots.`,
    );
  }
  const piece = PIECES[pieceRaw];

  const n = deriveNames(config.namespace, name, opts.displayName);
  const { bpRel, rpRel } = packRoots(config);
  const icon = stripPng((opts.icon ?? name).trim());

  const durability = opts.durability ?? piece.defaultDurability;
  const protection = opts.protection ?? piece.defaultProtection;
  const repairItem = (opts.repairItem ?? DEFAULT_REPAIR_ITEM).trim();

  // BP item. Key order mirrors the §4.3 skeleton (max_stack_size leads).
  tree.write(
    `${bpRel}/items/${name}.item.json`,
    renderItemJson({
      formatVersion: VERSIONS.armorItem,
      identifier: n.identifier,
      category: "equipment",
      components: {
        "minecraft:max_stack_size": 1,
        "minecraft:icon": n.atlasKey,
        "minecraft:display_name": { value: n.displayName },
        "minecraft:enchantable": { value: ENCHANT_VALUE, slot: piece.enchantSlot },
        "minecraft:durability": {
          max_durability: durability,
          damage_chance: { min: 60, max: 100 },
        },
        "minecraft:wearable": { slot: piece.wearableSlot, protection },
        "minecraft:repairable": {
          repair_items: [
            { items: [repairItem], repair_amount: "query.max_durability * 0.25" },
          ],
        },
      },
    }),
  );

  mergeItemTexture(tree, rpRel, n.atlasKey, `textures/items/${icon}`);
  ensureLanguages(tree, rpRel);
  mergeLang(tree, rpRel, `item.${n.identifier}`, n.displayName);

  const notes: string[] = [`Drop the icon PNG at RP/textures/items/${icon}.png`];

  const mode = (opts.mode ?? "icon").toLowerCase();
  if (mode === "3d") {
    const geometry = (opts.geometry ?? `geometry.${n.namespace}.${name}`).trim();
    const texture = stripPng((opts.texture ?? `textures/${n.namespace}/models/${name}`).trim());
    const rcId = `controller.render.${n.atlasKey}`;

    tree.write(
      `${rpRel}/attachables/${name}.attachable.json`,
      renderArmorAttachableJson({
        identifier: n.identifier,
        geometry,
        texture,
        renderController: rcId,
      }),
    );

    tree.write(
      `${rpRel}/render_controllers/${name}.rc.json`,
      renderRenderControllerJson({ id: rcId }),
    );

    notes.push(
      `3D armor: import your armor model + texture (texture at ${texture}.png). If it doesn't render, adjust the geometry yourself — the generator wires the references, not the art.`,
    );
  } else {
    notes.push(
      `icon mode: the buff applies, but NO armor renders on the body without an attachable. Re-run with --mode 3d to add one.`,
    );
  }

  return { notes };
}
