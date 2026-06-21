import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * A tiny Nx-Devkit-style in-memory virtual filesystem. SPEC §3.3.
 *
 * Generators never touch disk directly; they mutate a `Tree`, the runner
 * computes a change plan, prints it, and flushes once at the end. One
 * abstraction yields `--dry-run`, atomic all-or-nothing writes, conflict
 * reporting, and disk-free unit tests.
 *
 * Paths are relative to `rootAbs` (the project's config dir) and always use
 * forward slashes. `read`/`exists` check pending writes first, then disk.
 */
export class Tree {
  /** relPath → next content (overrides disk). */
  readonly writes = new Map<string, string>();

  /**
   * Paths written via {@link writeMerge} (shared registry/lang files). These are
   * read-merge-write, so the planner treats a differing result as an allowed
   * `update`, never a `conflict`. Owned feature files (items, blocks, …) are NOT
   * in this set and stay conflict-gated.
   */
  readonly mergePaths = new Set<string>();

  /** Absolute root the relative paths are anchored at (the config dir). */
  readonly rootAbs: string;

  constructor(rootAbs: string) {
    this.rootAbs = rootAbs;
  }

  /** Resolve a tree-relative path to an absolute filesystem path. */
  abs(rel: string): string {
    return isAbsolute(rel) ? rel : resolve(this.rootAbs, rel);
  }

  /** True if the path has a pending write OR exists on disk. */
  exists(rel: string): boolean {
    if (this.writes.has(rel)) return true;
    return existsSync(this.abs(rel));
  }

  /**
   * Read the pending content if any, else the on-disk content, else `null`.
   * Synchronous so registry merges read-modify-write in one pass.
   */
  read(rel: string): string | null {
    if (this.writes.has(rel)) return this.writes.get(rel)!;
    const abs = this.abs(rel);
    if (!existsSync(abs)) return null;
    try {
      return readFileSync(abs, "utf8");
    } catch {
      return null;
    }
  }

  /** Stage a write. Replaces any prior pending write for the same path. */
  write(rel: string, content: string): void {
    this.writes.set(rel, content);
  }

  /**
   * Stage a read-merge-write of a shared registry/lang file. Same as
   * {@link write} but flags the path as a merge so the planner never gates it as
   * a conflict (the merge already preserved every existing key).
   */
  writeMerge(rel: string, content: string): void {
    this.writes.set(rel, content);
    this.mergePaths.add(rel);
  }

  /** Stable list of staged paths (sorted for deterministic plans). */
  paths(): string[] {
    return [...this.writes.keys()].sort();
  }

  /**
   * Flush every staged write to disk: `mkdir -r` the parent then `writeFile`.
   * Caller is responsible for having resolved conflicts first.
   */
  async flush(): Promise<void> {
    for (const rel of this.paths()) {
      const abs = this.abs(rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, this.writes.get(rel)!, "utf8");
    }
  }
}
