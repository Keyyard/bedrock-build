import type { PlannedFile } from "./types.js";
import type { Tree } from "./tree.js";

/**
 * Compute the change plan for a staged Tree. SPEC §3.3 (Plop's safe default):
 *   - not on disk              → create
 *   - on disk, identical       → skip  (idempotent re-run is a no-op)
 *   - shared registry/lang file that differs → update (always safe to write)
 *   - owned file differs, !force → conflict (abort whole generator, write nothing)
 *   - owned file differs, force  → overwrite
 *
 * Registry/lang files (item_texture, terrain_texture, blocks.json, en_US.lang,
 * languages.json) are read-merge-write: the merge already preserved every
 * existing key, so a differing result is an expected `update`, never a
 * `conflict`. Without this, adding the very first key into a seeded (non-empty)
 * registry would abort every generator. Only owned feature files are gated.
 */
export function planTree(tree: Tree, force: boolean): PlannedFile[] {
  const out: PlannedFile[] = [];
  for (const relPath of tree.paths()) {
    const nextContent = tree.writes.get(relPath)!;
    const absPath = tree.abs(relPath);

    let status: PlannedFile["status"];
    const existing = onDiskContent(tree, relPath);
    if (existing === null) {
      status = "create";
    } else if (existing === nextContent) {
      status = "skip";
    } else if (tree.mergePaths.has(relPath)) {
      status = "update";
    } else if (force) {
      status = "overwrite";
    } else {
      status = "conflict";
    }

    out.push({ relPath, absPath, nextContent, status });
  }
  return out;
}

/**
 * The on-disk content for a path, ignoring the pending write so we can compare
 * the staged content against what is actually on disk.
 */
function onDiskContent(tree: Tree, rel: string): string | null {
  // Temporarily drop the pending write to read disk, then restore.
  const pending = tree.writes.get(rel);
  tree.writes.delete(rel);
  const disk = tree.read(rel);
  if (pending !== undefined) tree.writes.set(rel, pending);
  return disk;
}

/** True if any planned file is an unforced conflict. */
export function hasConflict(plan: readonly PlannedFile[]): boolean {
  return plan.some((f) => f.status === "conflict");
}
