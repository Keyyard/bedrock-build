import { mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { BedrockConfig } from "./config.js";

/**
 * Compute the destination root inside `<out>/packs/...` for a given pack type.
 */
function destRoot(config: BedrockConfig, kind: "BP" | "RP"): string {
  return join(config.out, "packs", kind);
}

/**
 * Returns true when `relPath` (with forward or backslash separators) is the
 * top-level `scripts/` directory of a BP source tree — that path is reserved
 * for the bundled output. SPEC §5.1 step 4 (defensive skip).
 */
function isTopLevelScripts(relPath: string): boolean {
  if (relPath === "scripts" || relPath === "scripts/") return true;
  // The first path segment must be exactly "scripts".
  const firstSep = relPath.search(/[\\/]/);
  if (firstSep === -1) return relPath === "scripts";
  return relPath.slice(0, firstSep) === "scripts";
}

/**
 * Recursively copy `srcDir` into `dstDir`, optionally skipping the top-level
 * `scripts/` directory (only used for BP). Uses Node fs/promises only — no
 * extra deps per SPEC §6.
 */
async function copyTree(
  srcDir: string,
  dstDir: string,
  skipTopLevelScripts: boolean,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch (err) {
    // If the source pack dir doesn't exist, the config validator would have
    // already failed — re-throw to surface the real cause if we ever get here.
    throw err;
  }

  await mkdir(dstDir, { recursive: true });

  for (const entry of entries) {
    if (skipTopLevelScripts && entry.isDirectory() && entry.name === "scripts") {
      continue;
    }
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(srcPath, dstPath, false);
    } else if (entry.isFile()) {
      await copyFile(srcPath, dstPath);
    } else if (entry.isSymbolicLink()) {
      // Resolve symlink targets to the actual file content. Bedrock packs are
      // not expected to use symlinks, but handle them defensively.
      const real = await stat(srcPath).catch(() => null);
      if (real?.isFile()) {
        await copyFile(srcPath, dstPath);
      }
    }
    // Sockets, FIFOs, etc. are intentionally ignored.
  }
}

/**
 * Copy pack source files into the dist tree. SPEC §5.1 steps 4–5.
 *
 *   `<configDir>/<packs.bp>/*` → `<out>/packs/BP/*` (excluding `scripts/`)
 *   `<configDir>/<packs.rp>/*` → `<out>/packs/RP/*`
 */
export async function copyPackFiles(config: BedrockConfig): Promise<void> {
  await copyTree(config.packs.bp, destRoot(config, "BP"), true);
  await copyTree(config.packs.rp, destRoot(config, "RP"), false);
}

/**
 * Determine which pack a path lives under, returning the pack kind, the
 * pack-relative path (POSIX-normalized for comparison), and the destination
 * file path. Returns `null` if the path is outside both packs.
 */
function classify(
  config: BedrockConfig,
  changedPath: string,
): { kind: "BP" | "RP"; relPath: string; destPath: string } | null {
  const abs = resolve(changedPath);

  const bpRel = relative(config.packs.bp, abs);
  if (bpRel && !bpRel.startsWith("..") && !bpRel.startsWith(sep + "..")) {
    return {
      kind: "BP",
      relPath: bpRel,
      destPath: join(destRoot(config, "BP"), bpRel),
    };
  }

  const rpRel = relative(config.packs.rp, abs);
  if (rpRel && !rpRel.startsWith("..") && !rpRel.startsWith(sep + "..")) {
    return {
      kind: "RP",
      relPath: rpRel,
      destPath: join(destRoot(config, "RP"), rpRel),
    };
  }

  return null;
}

/**
 * Copy a single file from a source pack to its dist mirror. Used by watch
 * mode on incremental change. Silently skips:
 *   - paths outside either pack root
 *   - paths under `<packs.bp>/scripts/` (reserved for bundled output)
 *   - paths that no longer exist (e.g., a transient editor swap file)
 */
export async function copyPackFile(
  config: BedrockConfig,
  changedPath: string,
): Promise<void> {
  const info = classify(config, changedPath);
  if (!info) return;
  if (info.kind === "BP" && isTopLevelScripts(info.relPath)) return;

  let st;
  try {
    st = await stat(changedPath);
  } catch {
    return; // file was removed between event and copy
  }
  if (!st.isFile()) return;

  await mkdir(dirname(info.destPath), { recursive: true });
  await copyFile(changedPath, info.destPath);
}
