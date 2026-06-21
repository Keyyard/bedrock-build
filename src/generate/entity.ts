import type { BedrockConfig } from "../config.js";
import type { CreateOptions, GeneratorResult } from "./core/types.js";
import type { Tree } from "./core/tree.js";
import { GenerateError } from "./core/errors.js";
import { validateName } from "./core/identifier.js";
import { deriveNames, stripPng } from "./core/names.js";
import { packRoots } from "./core/paths.js";
import { ensureLanguages, mergeLang } from "./core/registries.js";
import {
  renderBpEntityJson,
  renderClientEntity2dJson,
  renderClientEntity3dJson,
} from "./templates/entity.js";

const DEFAULT_BASE_COLOR = "#000000";
const DEFAULT_OVERLAY_COLOR = "#ffffff";

/**
 * create:entity pure planner. SPEC §4.5. Emits the pair (BP + RP, identical
 * identifier). BP files live under `entities/` (PLURAL); RP client_entity under
 * `entity/` (SINGULAR). No geometry/animation/texture files generated for 3D —
 * the client entity only references them.
 */
export function planEntity(
  tree: Tree,
  config: BedrockConfig,
  opts: CreateOptions,
): GeneratorResult {
  const name = (opts.name ?? "").trim();
  const check = validateName(name);
  if (check !== true) throw new GenerateError(check);

  const n = deriveNames(config.namespace, name, opts.displayName);
  const { bpRel, rpRel } = packRoots(config);

  // BP entity (entities/, plural). Both modes share the same alive-mob skeleton.
  tree.write(
    `${bpRel}/entities/${name}.json`,
    renderBpEntityJson({ identifier: n.identifier, family: name }),
  );

  const mode = (opts.mode ?? "3d").toLowerCase();
  const baseColor = DEFAULT_BASE_COLOR;
  const overlayColor = DEFAULT_OVERLAY_COLOR;

  const notes: string[] = [];

  if (mode === "2d") {
    const texture = stripPng((opts.texture ?? `textures/entity/${name}`).trim());
    tree.write(
      `${rpRel}/entity/${name}.json`,
      renderClientEntity2dJson({
        identifier: n.identifier,
        geometry: "geometry.item_sprite",
        texture,
        baseColor,
        overlayColor,
      }),
    );
    notes.push(`2D entity: drop the sprite texture at ${texture}.png.`);
  } else {
    const geometry = (opts.geometry ?? `geometry.${n.namespace}.${name}`).trim();
    const texture = stripPng((opts.texture ?? `textures/entity/${name}`).trim());
    tree.write(
      `${rpRel}/entity/${name}.json`,
      renderClientEntity3dJson({
        identifier: n.identifier,
        geometry,
        texture,
        baseColor,
        overlayColor,
      }),
    );
    notes.push(
      `3D entity: import your model into RP/models/entity/, your texture at ${texture}.png, and attach animations + scripts.animate in the client entity. If it doesn't render, adjust the geometry yourself.`,
    );
  }

  // Lang side-effects (RP). Both the entity name and the spawn-egg name.
  ensureLanguages(tree, rpRel);
  mergeLang(tree, rpRel, `entity.${n.identifier}.name`, n.displayName);
  mergeLang(
    tree,
    rpRel,
    `item.spawn_egg.entity.${n.identifier}.name`,
    `Spawn ${n.displayName}`,
  );

  notes.push(`No spawn_rules file generated — use the spawn egg or /summon ${n.identifier}.`);

  return { notes };
}
