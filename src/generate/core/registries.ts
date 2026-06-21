import type { Tree } from "./tree.js";
import { VERSIONS } from "./versions.js";

/**
 * Idempotent, key-based registry merges. SPEC §3.3 / §5 / §11.
 *
 * Every merge is read-merge-write: parse the existing (or a seeded skeleton if
 * absent — §11 create-if-absent for 2.x), upsert the key, re-serialize with
 * sorted keys so diffs stay clean and re-adding the same key+value is a no-op
 * (the Tree planner then classifies it `skip`, never `conflict`).
 *
 * Registry-relative paths are anchored at the RP/BP pack roots, which the
 * planners pass in (already pack-relative to the tree root).
 */

const INDENT = 2;

/** Two spaces per level, trailing newline — matches the seeded starter style. */
function serialize(obj: unknown): string {
  return JSON.stringify(obj, null, INDENT) + "\n";
}

function parseJsonOr<T>(tree: Tree, rel: string, fallback: T): T {
  const raw = tree.read(rel);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed as T;
  } catch {
    // Malformed registry on disk: start from the seeded skeleton rather than
    // crash. The merge then produces a valid file.
    return fallback;
  }
}

/** Sort an object's keys for deterministic, clean-diff serialization. */
function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = obj[key];
  }
  return out as T;
}

interface AtlasFile {
  resource_pack_name?: string;
  texture_name?: string;
  padding?: number;
  num_mip_levels?: number;
  texture_data: Record<string, { textures: string }>;
}

/**
 * Upsert into `textures/item_texture.json`. SPEC §3.3 / §3.6:
 * `texture_data[key] = { textures: "<path>" }`. Seeds the vanilla skeleton if
 * absent (§11). `rpRel` is the RP pack root, tree-relative.
 */
export function mergeItemTexture(
  tree: Tree,
  rpRel: string,
  key: string,
  texturePath: string,
): void {
  const rel = `${rpRel}/textures/item_texture.json`;
  const file = parseJsonOr<AtlasFile>(tree, rel, {
    resource_pack_name: "vanilla",
    texture_name: "atlas.items",
    texture_data: {},
  });
  if (!file.texture_data || typeof file.texture_data !== "object") {
    file.texture_data = {};
  }
  file.texture_data[key] = { textures: texturePath };
  file.texture_data = sortKeys(file.texture_data);
  tree.write(rel, serialize(file));
}

/**
 * Upsert into `textures/terrain_texture.json`. Seeds the vanilla skeleton
 * (num_mip_levels 0, padding 8) if absent (§11).
 */
export function mergeTerrainTexture(
  tree: Tree,
  rpRel: string,
  key: string,
  texturePath: string,
): void {
  const rel = `${rpRel}/textures/terrain_texture.json`;
  const file = parseJsonOr<AtlasFile>(tree, rel, {
    resource_pack_name: "vanilla",
    texture_name: "atlas.terrain",
    padding: 8,
    num_mip_levels: 0,
    texture_data: {},
  });
  if (!file.texture_data || typeof file.texture_data !== "object") {
    file.texture_data = {};
  }
  file.texture_data[key] = { textures: texturePath };
  file.texture_data = sortKeys(file.texture_data);
  tree.write(rel, serialize(file));
}

interface BlocksFile {
  format_version?: string;
  [id: string]: unknown;
}

/**
 * Upsert into RP `blocks.json`. SPEC §3.3: `root[id] = { textures, sound }`.
 * Seeds `{ "format_version": "1.10.0" }` if absent (§11). `format_version` is
 * kept first; block entries are sorted for clean diffs.
 */
export function mergeBlocks(
  tree: Tree,
  rpRel: string,
  id: string,
  textureKey: string,
  sound: string,
): void {
  const rel = `${rpRel}/blocks.json`;
  const file = parseJsonOr<BlocksFile>(tree, rel, {
    format_version: VERSIONS.blocksJson,
  });

  const formatVersion =
    typeof file.format_version === "string" ? file.format_version : VERSIONS.blocksJson;

  // Collect existing block entries (everything except format_version).
  const entries: Record<string, unknown> = {};
  for (const k of Object.keys(file)) {
    if (k === "format_version") continue;
    entries[k] = file[k];
  }
  entries[id] = { textures: textureKey, sound };

  const sorted = sortKeys(entries);
  const out: Record<string, unknown> = { format_version: formatVersion, ...sorted };
  tree.write(rel, serialize(out));
}

/**
 * Upsert a lang key into `texts/en_US.lang`. SPEC §3.3: parse into key→value
 * (split on first `=`), upsert preserving order/comments, append new keys,
 * never duplicate. Seeds an empty file if absent (§11). `packRel` is the pack
 * root (RP), tree-relative.
 */
export function mergeLang(
  tree: Tree,
  packRel: string,
  key: string,
  value: string,
): void {
  const rel = `${packRel}/texts/en_US.lang`;
  const raw = tree.read(rel);
  const lines = raw === null ? [] : raw.split(/\r?\n/);

  let replaced = false;
  const out: string[] = [];
  for (const line of lines) {
    const eq = line.indexOf("=");
    // Preserve comments and blank lines verbatim.
    if (eq === -1 || line.trimStart().startsWith("#") || line.trimStart().startsWith("//")) {
      out.push(line);
      continue;
    }
    const existingKey = line.slice(0, eq).trim();
    if (existingKey === key) {
      out.push(`${key}=${value}`);
      replaced = true;
    } else {
      out.push(line);
    }
  }

  if (!replaced) {
    // Drop a trailing empty line before appending so we don't accumulate blanks.
    while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();
    out.push(`${key}=${value}`);
  }

  // Always terminate with a single trailing newline.
  const text = out.join("\n").replace(/\n*$/, "") + "\n";
  tree.write(rel, text);
}

/**
 * Ensure `texts/languages.json` contains `"en_US"`. SPEC §3.3 / §5 / §11:
 * load-bearing — without it the game silently ignores en_US.lang. Creates the
 * file as `["en_US"]` if absent.
 */
export function ensureLanguages(tree: Tree, packRel: string): void {
  const rel = `${packRel}/texts/languages.json`;
  const list = parseJsonOr<string[]>(tree, rel, []);
  const arr = Array.isArray(list) ? list : [];
  if (!arr.includes("en_US")) arr.push("en_US");
  tree.write(rel, serialize(arr));
}
