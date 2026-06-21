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

/** Tool variants. SPEC §4.2: each swaps item tag, enchant slot, digger query, default damage. */
export type ToolVariant = "pickaxe" | "axe" | "shovel" | "hoe";

interface VariantRow {
  itemTag: string;
  enchantSlot: string;
  diggerQuery: string;
  defaultDamage: number;
}

const VARIANTS: Record<ToolVariant, VariantRow> = {
  pickaxe: {
    itemTag: "minecraft:is_pickaxe",
    enchantSlot: "pickaxe",
    diggerQuery: "minecraft:is_pickaxe_item_destructible",
    defaultDamage: 6,
  },
  axe: {
    itemTag: "minecraft:is_axe",
    enchantSlot: "axe",
    diggerQuery: "minecraft:is_axe_item_destructible",
    defaultDamage: 7,
  },
  shovel: {
    itemTag: "minecraft:is_shovel",
    enchantSlot: "shovel",
    diggerQuery: "minecraft:is_shovel_item_destructible",
    defaultDamage: 5,
  },
  hoe: {
    itemTag: "minecraft:is_hoe",
    enchantSlot: "hoe",
    diggerQuery: "minecraft:is_hoe_item_destructible",
    defaultDamage: 4,
  },
};

const DEFAULT_DURABILITY = 1562; // diamond-tier
const DEFAULT_ENCHANT_VALUE = 10;
const DEFAULT_TIER = "diamond";
const DEFAULT_REPAIR_ITEM = "minecraft:diamond";

function isVariant(v: string): v is ToolVariant {
  return v === "pickaxe" || v === "axe" || v === "shovel" || v === "hoe";
}

/**
 * create:tool pure planner. SPEC §4.2. 2D only, diamond-tier defaults, with the
 * pickaxe/axe/shovel/hoe variant picker.
 */
export function planTool(
  tree: Tree,
  config: BedrockConfig,
  opts: CreateOptions,
): GeneratorResult {
  const name = (opts.name ?? "").trim();
  const check = validateName(name);
  if (check !== true) throw new GenerateError(check);

  const variantRaw = (opts.variant ?? "pickaxe").toLowerCase();
  if (!isVariant(variantRaw)) {
    throw new GenerateError(
      `Unknown tool variant "${variantRaw}". Use one of: pickaxe, axe, shovel, hoe.`,
    );
  }
  const variant = VARIANTS[variantRaw];

  const n = deriveNames(config.namespace, name, opts.displayName);
  const { bpRel, rpRel } = packRoots(config);
  const icon = stripPng((opts.icon ?? name).trim());

  const tier = (opts.tier ?? DEFAULT_TIER).trim();
  const durability = opts.durability ?? DEFAULT_DURABILITY;
  const damage = opts.damage ?? variant.defaultDamage;
  const enchantValue = opts.enchantValue ?? DEFAULT_ENCHANT_VALUE;
  const repairItem = (opts.repairItem ?? DEFAULT_REPAIR_ITEM).trim();

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
        "minecraft:durability": { max_durability: durability },
        "minecraft:damage": damage,
        "minecraft:enchantable": { slot: variant.enchantSlot, value: enchantValue },
        "minecraft:repairable": {
          repair_items: [
            {
              items: [repairItem],
              repair_amount:
                "context.other->q.remaining_durability + 0.05 * context.other->q.max_durability",
            },
          ],
        },
        "minecraft:digger": {
          use_efficiency: true,
          destroy_speeds: [
            {
              block: { tags: `query.any_tag('${variant.diggerQuery}')` },
              speed: 8,
            },
          ],
        },
        "minecraft:tags": { tags: [variant.itemTag, `minecraft:${tier}_tier`] },
      },
    }),
  );

  mergeItemTexture(tree, rpRel, n.atlasKey, `textures/items/${icon}`);
  ensureLanguages(tree, rpRel);
  mergeLang(tree, rpRel, `item.${n.identifier}`, n.displayName);

  return {
    notes: [`Drop the icon PNG at RP/textures/items/${icon}.png`],
  };
}
