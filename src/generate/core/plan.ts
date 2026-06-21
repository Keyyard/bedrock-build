import type { PlannedFile } from "./types.js";
import type { Tree } from "./tree.js";

/**
 * Compute the change plan for a staged Tree. SPEC §3.3 (Plop's safe default):
 *   - not on disk          → create
 *   - on disk, identical   → skip  (idempotent re-run is a no-op)
 *   - on disk, differs, !force → conflict (abort whole generator, write nothing)
 *   - on disk, differs, force  → overwrite
 *
 * Registry files are merged read-modify-write before this runs, so a re-added
 * key serializes byte-identical and classifies as `skip`, never `conflict`.
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
