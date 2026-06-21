import type { BedrockConfig } from "../config.js";
import type { CreateOptions, GeneratorResult } from "./core/types.js";
import type { Tree } from "./core/tree.js";
import { GenerateError } from "./core/errors.js";
import { validateName } from "./core/identifier.js";
import { deriveNames, stripPng } from "./core/names.js";
import { packRoots } from "./core/paths.js";
import {
  ensureLanguages,
  mergeBlocks,
  mergeLang,
  mergeTerrainTexture,
} from "./core/registries.js";
import { renderBlockJson } from "./templates/block.js";

const DEFAULT_RENDER_METHOD = "opaque";
const DEFAULT_SOUND = "stone";
const VALID_RENDER_METHODS = new Set(["opaque", "blend", "alpha_test"]);

/**
 * create:block pure planner. SPEC §4.6. Four artifacts: BP block,
 * terrain_texture key, blocks.json entry, tile lang line. Always emits BOTH
 * geometry + material_instances (the 1.21.80 pairing rule). The
 * material_instances.texture is the terrain_texture KEY, not a path.
 */
export function planBlock(
  tree: Tree,
  config: BedrockConfig,
  opts: CreateOptions,
): GeneratorResult {
  const name = (opts.name ?? "").trim();
  const check = validateName(name);
  if (check !== true) throw new GenerateError(check);

  const renderMethod = (opts.renderMethod ?? DEFAULT_RENDER_METHOD).toLowerCase();
  if (!VALID_RENDER_METHODS.has(renderMethod)) {
    throw new GenerateError(
      `Unknown render method "${renderMethod}". Use one of: opaque, blend, alpha_test.`,
    );
  }

  const n = deriveNames(config.namespace, name, opts.displayName);
  const { bpRel, rpRel } = packRoots(config);
  // The block "texture" prompt feeds both the terrain path and defaults to name.
  const texture = stripPng((opts.texture ?? name).trim());
  const sound = (opts.sound ?? DEFAULT_SOUND).trim();

  // 1) BP block.
  tree.write(
    `${bpRel}/blocks/${name}.block.json`,
    renderBlockJson({
      identifier: n.identifier,
      atlasKey: n.atlasKey,
      renderMethod,
      light: opts.light,
    }),
  );

  // 2) terrain_texture key → path.
  mergeTerrainTexture(tree, rpRel, n.atlasKey, `textures/blocks/${texture}`);

  // 3) blocks.json entry.
  mergeBlocks(tree, rpRel, n.identifier, n.atlasKey, sound);

  // 4) tile lang line.
  ensureLanguages(tree, rpRel);
  mergeLang(tree, rpRel, `tile.${n.identifier}.name`, n.displayName);

  return {
    notes: [`Drop the block PNG at RP/textures/blocks/${texture}.png`],
  };
}
