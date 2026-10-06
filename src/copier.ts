import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { BedrockConfig } from "./config.js";

/** Max concurrent file operations. Bounds I/O fan-out on asset-heavy packs. */
const COPY_CONCURRENCY = 16;

interface CopyTask {
  src: string;
  dst: string;
}

/**
 * Compute the destination root inside `<out>/packs/...` for a given pack type.
 */
function destRoot(config: BedrockConfig, kind: "BP" | "RP"): string {
  return join(config.out, "packs", kind);
}

/** Normalize path separators to POSIX so src/dst trees compare by the same key. */
function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Run `worker` over `items` with at most `limit` operations in flight.
 * Resolves when all items are processed; rejects on the first worker error.
 */
async function runBounded<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Math.min(limit, items.length);
  const runners: Promise<void>[] = [];
  for (let lane = 0; lane < lanes; lane++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) break;
          await worker(items[idx]!);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/**
 * Returns true when `relPath` (with forward or backslash separators) is the
 * top-level `scripts/` directory of a BP source tree. that path is reserved
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
 * Mirror pack source files into the dist tree. SPEC §5.1 steps 4-5.
 *
 *   `<configDir>/<packs.bp>/*` → `<out>/packs/BP/*` (excluding `scripts/`)
 *   `<configDir>/<packs.rp>/*` → `<out>/packs/RP/*`
 *
 * This is a **mirror**, not a copy: a file deleted or moved in the pack source
 * is removed from dist too. Copy-only left the old path behind forever, and
 * `deploy` then faithfully shipped both — which Bedrock loads as two
 * definitions of the same id, one of them silently winning. Renaming a folder
 * was enough to ship a stale item or an animation that overrode its own
 * replacement.
 *
 * `<out>/packs/BP/scripts/` is exempt at both ends: the bundler owns it, and
 * `build` runs this concurrently with the bundle write.
 */
export async function copyPackFiles(config: BedrockConfig): Promise<void> {
  await Promise.all([
    syncTree(config.packs.bp, destRoot(config, "BP"), {
      skipSource: isTopLevelScripts,
      keepInDest: isTopLevelScripts,
    }),
    syncTree(config.packs.rp, destRoot(config, "RP")),
  ]);
}

interface FileEntry {
  abs: string;
  size: number;
  mtimeMs: number;
}

/**
 * Walk `root` recursively, returning a map of POSIX-normalized relative path →
 * file metadata. A missing root yields an empty map (treated as "nothing
 * there yet"), which is what callers want for a not-yet-created deploy target.
 */
async function walkFiles(root: string): Promise<Map<string, FileEntry>> {
  const out = new Map<string, FileEntry>();

  async function recurse(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // missing or unreadable dir
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await recurse(abs);
      } else if (entry.isFile()) {
        const st = await stat(abs);
        out.set(toPosix(relative(root, abs)), {
          abs,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      } else if (entry.isSymbolicLink()) {
        const st = await stat(abs).catch(() => null);
        if (st?.isFile()) {
          out.set(toPosix(relative(root, abs)), {
            abs,
            size: st.size,
            mtimeMs: st.mtimeMs,
          });
        }
      }
    }
  }

  await recurse(root);
  return out;
}

export interface SyncTreeOptions {
  /**
   * Source paths to leave out of the mirror entirely, by POSIX-normalized
   * relative path. Used to hand a subtree to another writer.
   */
  skipSource?: (relPath: string) => boolean;

  /**
   * Destination paths this sync must never delete, by POSIX-normalized
   * relative path. Anything written by someone else — the script bundle —
   * belongs here, or the mirror would treat it as stale and remove it.
   */
  keepInDest?: (relPath: string) => boolean;
}

/**
 * Incrementally sync `srcRoot` into `dstRoot`: copy files that are new or
 * changed (different size, or newer source mtime) and delete files present in
 * the destination but not the source. Avoids re-copying an unchanged pack tree
 * on every deploy. File operations run with bounded concurrency.
 */
export async function syncTree(
  srcRoot: string,
  dstRoot: string,
  options: SyncTreeOptions = {},
): Promise<void> {
  const [srcFiles, dstFiles] = await Promise.all([
    walkFiles(srcRoot),
    walkFiles(dstRoot),
  ]);

  await mkdir(dstRoot, { recursive: true });

  const copyTasks: CopyTask[] = [];
  for (const [rel, s] of srcFiles) {
    if (options.skipSource?.(rel)) continue;
    const d = dstFiles.get(rel);
    if (!d || d.size !== s.size || s.mtimeMs > d.mtimeMs) {
      copyTasks.push({ src: s.abs, dst: join(dstRoot, ...rel.split("/")) });
    }
  }

  const deletions: string[] = [];
  for (const rel of dstFiles.keys()) {
    if (options.keepInDest?.(rel)) continue;
    if (!srcFiles.has(rel)) {
      deletions.push(join(dstRoot, ...rel.split("/")));
    }
  }

  await runBounded(copyTasks, COPY_CONCURRENCY, async (t) => {
    await mkdir(dirname(t.dst), { recursive: true });
    await copyFile(t.src, t.dst);
  });
  await runBounded(deletions, COPY_CONCURRENCY, (p) => rm(p, { force: true }));
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
