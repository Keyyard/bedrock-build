import { rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

import type { BedrockConfig } from "../config.js";
import { buildBundle, buildBundleWithWatch } from "../bundler.js";
import { copyPackFile, copyPackFiles } from "../copier.js";
import { logger } from "../logger.js";

export interface WatchOptions {
  // No watch-specific flags in v1; reserved for future extension.
}

/** ISO-8601 short timestamp (HH:mm:ss) for per-event log lines. SPEC §7. */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Classify a pack-source path, returning the dist mirror destination, or
 * `null` if the path is outside both pack roots or under `<packs.bp>/scripts/`
 * (which is owned by the bundler).
 */
function destForPackPath(
  config: BedrockConfig,
  changedPath: string,
): string | null {
  const abs = resolve(changedPath);

  const bpRel = relative(config.packs.bp, abs);
  if (bpRel && !bpRel.startsWith("..") && !bpRel.startsWith(sep + "..")) {
    // Skip <packs.bp>/scripts/**. owned by the bundler.
    const first = bpRel.split(/[\\/]/, 1)[0];
    if (first === "scripts") return null;
    return join(config.out, "packs", "BP", bpRel);
  }

  const rpRel = relative(config.packs.rp, abs);
  if (rpRel && !rpRel.startsWith("..") && !rpRel.startsWith(sep + "..")) {
    return join(config.out, "packs", "RP", rpRel);
  }

  return null;
}

/**
 * Build the chokidar watcher for both pack source roots, ignoring the
 * BP `scripts/` subtree and the dist output directory. SPEC §5.2.
 */
function createPackWatcher(config: BedrockConfig): FSWatcher {
  const bpScripts = join(config.packs.bp, "scripts");
  const distRoot = config.out;
  return chokidar.watch([config.packs.bp, config.packs.rp], {
    ignored: (p: string) => {
      if (!p) return false;
      // Normalize for prefix comparison
      if (p === bpScripts) return true;
      if (p.startsWith(bpScripts + sep) || p.startsWith(bpScripts + "/")) return true;
      if (p === distRoot) return true;
      if (p.startsWith(distRoot + sep) || p.startsWith(distRoot + "/")) return true;
      return false;
    },
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 25,
    },
  });
}

/**
 * Run a watch-mode build. SPEC §5.2.
 *
 * 1. Initial dev-mode build (bundle + copy pack files).
 * 2. esbuild watch context for incremental source rebuilds.
 * 3. chokidar watcher mirroring pack-source changes into dist/.
 * 4. Ctrl+C: dispose bundler, close chokidar, exit code 0.
 *
 * Returns when the watcher is shut down (after SIGINT).
 */
export async function watch(
  config: BedrockConfig,
  _options: WatchOptions = {},
): Promise<void> {
  logger.info("Building (watch, dev)...");
  const initialStart = Date.now();
  const initialBundle = await buildBundle(config, { release: false });
  await copyPackFiles(config);
  logger.success(
    `Initial build in ${Date.now() - initialStart}ms (bundle ${initialBundle.elapsedMs}ms)`,
  );

  // Bundler watch. emits rebuilds for any change in the source graph.
  const bundlerCtx = await buildBundleWithWatch(
    config,
    { release: false },
    (result) => {
      logger.success(`[${timestamp()}] Rebuilt scripts in ${result.elapsedMs}ms`);
    },
  );

  // Pack-source watcher. Per-file mirror into dist/ on change/add/unlink.
  const packWatcher = createPackWatcher(config);

  packWatcher.on("add", (path: string) => {
    void handlePackChange(config, path, "add");
  });
  packWatcher.on("change", (path: string) => {
    void handlePackChange(config, path, "change");
  });
  packWatcher.on("unlink", (path: string) => {
    void handlePackUnlink(config, path);
  });
  packWatcher.on("error", (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`watcher error: ${message}`);
  });

  // Wait for the watcher's initial scan to complete so we don't race with
  // tests / callers that modify files immediately after watch() resolves.
  await new Promise<void>((resolveReady) => {
    packWatcher.once("ready", () => resolveReady());
  });

  logger.info(`Watching ${config.packs.bp} and ${config.packs.rp} for changes...`);
  logger.info("Press Ctrl+C to stop.");

  // Wait for SIGINT and shut down cleanly.
  await new Promise<void>((resolvePromise) => {
    const shutdown = async () => {
      logger.info("Shutting down watcher...");
      try {
        await bundlerCtx.dispose();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`bundler dispose: ${message}`);
      }
      try {
        await packWatcher.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`watcher close: ${message}`);
      }
      resolvePromise();
    };
    process.once("SIGINT", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown();
    });
  });
}

/**
 * Copy a single pack file into its dist mirror. Logs a warning on failure but
 * keeps the watcher alive.
 */
async function handlePackChange(
  config: BedrockConfig,
  path: string,
  kind: "add" | "change",
): Promise<void> {
  try {
    const dest = destForPackPath(config, path);
    if (dest === null) return; // outside or under scripts/
    await copyPackFile(config, path);
    logger.success(`[${timestamp()}] ${kind === "add" ? "added" : "updated"} ${relative(config.__configDir, path)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`failed to mirror ${path}: ${message}`);
  }
}

/**
 * Remove the dist mirror for a deleted pack file. Logs a warning on failure
 * but keeps the watcher alive.
 */
async function handlePackUnlink(
  config: BedrockConfig,
  path: string,
): Promise<void> {
  try {
    const dest = destForPackPath(config, path);
    if (dest === null) return;
    await rm(dest, { force: true });
    logger.success(`[${timestamp()}] removed ${relative(config.__configDir, path)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`failed to remove mirror for ${path}: ${message}`);
  }
}
