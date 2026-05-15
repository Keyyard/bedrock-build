import { mkdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import * as p from "@clack/prompts";
import pc from "picocolors";

import type { BedrockConfig } from "../config.js";

/**
 * Canonical Bedrock folder definition. `subpath` uses forward slashes and is
 * always relative to its pack root (`packs.bp` for BP, `packs.rp` for RP).
 */
export interface FolderDef {
  subpath: string;
  hint: string;
}

/**
 * Behavior pack canonical folders. SPEC §5.1 reserves `scripts/` for the
 * bundler output; it is intentionally absent here.
 *
 * Note the singular/plural footguns vs. RP: `entities` (plural) here,
 * `entity` (singular) under RP.
 */
export const BP_FOLDERS: FolderDef[] = [
  { subpath: "animation_controllers", hint: "Server-side animation controllers" },
  { subpath: "animations", hint: "Server-side animations" },
  { subpath: "biomes", hint: "Custom biome definitions" },
  { subpath: "blocks", hint: "Custom block behavior" },
  { subpath: "cameras/presets", hint: "Camera preset JSON" },
  { subpath: "dialogue", hint: "NPC dialogue trees" },
  { subpath: "entities", hint: "Server entity definitions  (NOTE: plural)" },
  { subpath: "feature_rules", hint: "World-gen feature placement rules" },
  { subpath: "features", hint: "World-gen feature definitions" },
  { subpath: "functions", hint: ".mcfunction files" },
  { subpath: "items", hint: "Custom item behavior" },
  { subpath: "loot_tables", hint: "Loot table definitions" },
  { subpath: "recipes", hint: "Crafting and smelting recipes" },
  { subpath: "spawn_rules", hint: "Where mobs spawn" },
  { subpath: "structures", hint: ".mcstructure files" },
  { subpath: "texts", hint: "Localization (languages.json + en_US.lang)" },
  { subpath: "trading", hint: "Villager trade tables" },
];

/** Resource pack canonical folders. */
export const RP_FOLDERS: FolderDef[] = [
  { subpath: "animation_controllers", hint: "Client-side animation controllers" },
  { subpath: "animations", hint: "Client-side animations" },
  { subpath: "attachables", hint: "Items rendered on the player (held / worn)" },
  { subpath: "entity", hint: "Client entity definitions  (NOTE: singular)" },
  { subpath: "fogs", hint: "Custom fog definitions" },
  { subpath: "font", hint: "Custom UI fonts" },
  { subpath: "materials", hint: "Custom rendering materials" },
  { subpath: "models/entity", hint: "Entity geometry .geo.json  (NOTE: singular)" },
  { subpath: "models/blocks", hint: "Block geometry .geo.json" },
  { subpath: "particles", hint: "Particle effect definitions" },
  { subpath: "render_controllers", hint: "Render controllers (geometry + materials per state)" },
  { subpath: "sounds", hint: "Sound files (referenced by sound_definitions.json)" },
  { subpath: "texts", hint: "Localization (languages.json + en_US.lang)" },
  { subpath: "textures/blocks", hint: "Block textures" },
  { subpath: "textures/entity", hint: "Entity textures  (NOTE: singular)" },
  { subpath: "textures/items", hint: "Item textures" },
  { subpath: "ui", hint: "Custom UI definitions (advanced)" },
];

export interface FolderOption {
  /** Absolute filesystem path that would be created. */
  value: string;
  /** Display label, with `(exists)` suffix when the folder is already present. */
  label: string;
  /** One-line description shown alongside the option. */
  hint: string;
  /** True if `value` already exists on disk at scan time. */
  existing: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function buildOptions(
  packRoot: string,
  configDir: string,
  defs: readonly FolderDef[],
): Promise<FolderOption[]> {
  return Promise.all(
    defs.map(async (def): Promise<FolderOption> => {
      const value = join(packRoot, ...def.subpath.split("/"));
      const existing = await exists(value);
      const rel = relative(configDir, value).replace(/\\/g, "/");
      return {
        value,
        label: existing ? `${rel} ${pc.dim("(exists)")}` : rel,
        hint: def.hint,
        existing,
      };
    }),
  );
}

/**
 * Compute the BP and RP option lists for the picker. Pure data, exposed for
 * testing and so callers can drive the picker outside of an interactive shell.
 */
export async function listFolderOptions(
  config: BedrockConfig,
): Promise<{ bp: FolderOption[]; rp: FolderOption[] }> {
  const [bp, rp] = await Promise.all([
    buildOptions(config.packs.bp, config.__configDir, BP_FOLDERS),
    buildOptions(config.packs.rp, config.__configDir, RP_FOLDERS),
  ]);
  return { bp, rp };
}

/**
 * Create each path in `paths` (recursive `mkdir`). Already-existing paths are
 * counted into `alreadyExisted` and skipped. The spec says no `.gitkeep`, so
 * empty dirs are fine.
 */
export async function createFolders(
  paths: readonly string[],
): Promise<{ created: number; alreadyExisted: number }> {
  let created = 0;
  let alreadyExisted = 0;
  for (const dir of paths) {
    if (await exists(dir)) {
      alreadyExisted++;
      continue;
    }
    await mkdir(dir, { recursive: true });
    created++;
  }
  return { created, alreadyExisted };
}

/**
 * Interactive folder scaffolder. Prompts for BP folders, then RP folders,
 * then creates the picked ones. SPEC §5.5.
 *
 * Pre-existing folders appear in the list with an `(exists)` marker so the
 * user can leave them alone. Cancelling either prompt aborts without touching
 * the disk.
 */
export async function folders(config: BedrockConfig): Promise<void> {
  p.intro(pc.cyan("bedrock-build folders"));

  const { bp: bpOpts, rp: rpOpts } = await listFolderOptions(config);

  const bpPicked = await p.multiselect({
    message: `Behavior pack folders  ${pc.dim(`(${relative(config.__configDir, config.packs.bp).replace(/\\/g, "/") || "."}/)`)}`,
    options: bpOpts.map(({ value, label, hint }) => ({ value, label, hint })),
    required: false,
  });
  if (p.isCancel(bpPicked)) {
    p.cancel("Cancelled.");
    return;
  }

  const rpPicked = await p.multiselect({
    message: `Resource pack folders  ${pc.dim(`(${relative(config.__configDir, config.packs.rp).replace(/\\/g, "/") || "."}/)`)}`,
    options: rpOpts.map(({ value, label, hint }) => ({ value, label, hint })),
    required: false,
  });
  if (p.isCancel(rpPicked)) {
    p.cancel("Cancelled.");
    return;
  }

  const picked = [...(bpPicked as string[]), ...(rpPicked as string[])];
  if (picked.length === 0) {
    p.outro("Nothing selected.");
    return;
  }

  const { created, alreadyExisted } = await createFolders(picked);

  const parts: string[] = [pc.green(`✓ ${created} created`)];
  if (alreadyExisted > 0) parts.push(pc.dim(`${alreadyExisted} already existed`));
  p.outro(parts.join(", "));
}
