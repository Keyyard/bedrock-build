import { cp, mkdir, rm, copyFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

import type { BedrockConfig } from "../config.js";
import { build } from "./build.js";
import { buildBundleWithWatch } from "../bundler.js";
import { copyPackFile } from "../copier.js";
import { resolveDeployTarget, type DeployTargets } from "../paths.js";
import { logger } from "../logger.js";

export interface DeployOptions {
  /** Build in release mode before deploying. SPEC §5.3. */
  release?: boolean;
  /** Re-deploy on file changes. SPEC §5.3. */
  watch?: boolean;
}

/** ISO-8601 short timestamp (HH:mm:ss) for per-event log lines. SPEC §7. */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Recursively copy `<src>/*` into `<dst>/`. Creates `<dst>` if missing.
 * Node 18+'s `fs.cp` with `recursive: true` handles this directly.
 */
async function copyTreeContents(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  await cp(src, dst, { recursive: true });
}

/**
 * Clean-slate deploy of `<out>/packs/BP|RP/` into the resolved targets.
 * Removes the target subdirs first to ensure deleted source files don't
 * linger.
 */
async function deployDistToTargets(
  config: BedrockConfig,
  targets: DeployTargets,
): Promise<void> {
  const bpSrc = join(config.out, "packs", "BP");
  const rpSrc = join(config.out, "packs", "RP");

  await rm(targets.bp, { recursive: true, force: true });
  await rm(targets.rp, { recursive: true, force: true });

  await copyTreeContents(bpSrc, targets.bp);
  await copyTreeContents(rpSrc, targets.rp);
}

/**
 * Resolve a pack-source path into its destination inside the deploy target.
 * Returns `null` for paths outside both pack roots or under `<packs.bp>/scripts/`
 * (owned by the bundler. bundler-rebuild path handles those separately).
 */
function deployDestForPackPath(
  config: BedrockConfig,
  targets: DeployTargets,
  changedPath: string,
): string | null {
  const abs = resolve(changedPath);

  const bpRel = relative(config.packs.bp, abs);
  if (bpRel && !bpRel.startsWith("..") && !bpRel.startsWith(sep + "..")) {
    const first = bpRel.split(/[\\/]/, 1)[0];
    if (first === "scripts") return null;
    return join(targets.bp, bpRel);
  }

  const rpRel = relative(config.packs.rp, abs);
  if (rpRel && !rpRel.startsWith("..") && !rpRel.startsWith(sep + "..")) {
    return join(targets.rp, rpRel);
  }

  return null;
}

/** Create the pack-source chokidar watcher used by deploy --watch. SPEC §5.2/§5.3. */
function createPackWatcher(config: BedrockConfig): FSWatcher {
  const bpScripts = join(config.packs.bp, "scripts");
  const distRoot = config.out;
  return chokidar.watch([config.packs.bp, config.packs.rp], {
    ignored: (p: string) => {
      if (!p) return false;
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
 * Build, then deploy to the resolved com.mojang target. SPEC §5.3.
 *
 * - One-shot: build → resolve target → clean-slate copy.
 * - `--watch`: above + esbuild watch + chokidar watch; pack changes are first
 *   mirrored into dist (via `copyPackFile`) and then copied into the target;
 *   bundler rebuilds are forwarded to the target as a single-file `main.js` copy.
 */
export async function deploy(
  config: BedrockConfig,
  options: DeployOptions = {},
): Promise<void> {
  const release = options.release ?? false;
  const watchMode = options.watch ?? false;

  // Step 1: full build (respecting --release).
  await build(config, { release, clean: false });

  // Step 2: resolve target. Lets DeployTargetError propagate (exit 3).
  const targets = await resolveDeployTarget(config);
  logger.info(`Deploying to ${targets.root}`);

  // Step 3-4: clean-slate copy of <out>/packs/{BP,RP} into target subdirs.
  await deployDistToTargets(config, targets);
  logger.success(`Deployed ${config.name} → ${targets.bp} and ${targets.rp}`);

  if (!watchMode) return;

  // ---- Watch mode -------------------------------------------------------
  logger.info(
    `Watching ${config.packs.bp} and ${config.packs.rp} for changes (deploy --watch${release ? " --release" : ""})...`,
  );

  const bundlerCtx = await buildBundleWithWatch(
    config,
    { release },
    async (result) => {
      // The bundler already wrote to <out>/packs/BP/scripts/main.js. Mirror it
      // to the target's scripts/main.js.
      try {
        const targetMain = join(targets.bp, "scripts", "main.js");
        await mkdir(dirname(targetMain), { recursive: true });
        await copyFile(result.outputPath, targetMain);
        logger.success(
          `[${timestamp()}] Rebuilt + deployed scripts in ${result.elapsedMs}ms`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`failed to deploy bundle: ${message}`);
      }
    },
  );

  const packWatcher = createPackWatcher(config);

  const mirrorPackChange = async (
    path: string,
    kind: "add" | "change",
  ): Promise<void> => {
    try {
      const dest = deployDestForPackPath(config, targets, path);
      if (dest === null) return;
      // First update dist (per spec: dist stays consistent).
      await copyPackFile(config, path);
      // Then copy to the deploy target.
      const src = path;
      try {
        const st = await stat(src);
        if (!st.isFile()) return;
      } catch {
        return; // file vanished between event and copy
      }
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      logger.success(
        `[${timestamp()}] ${kind === "add" ? "added" : "updated"} ${relative(config.__configDir, path)} → target`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`failed to mirror ${path}: ${message}`);
    }
  };

  const mirrorPackUnlink = async (path: string): Promise<void> => {
    try {
      const distMirror = (() => {
        const abs = resolve(path);
        const bpRel = relative(config.packs.bp, abs);
        if (bpRel && !bpRel.startsWith("..") && !bpRel.startsWith(sep + "..")) {
          const first = bpRel.split(/[\\/]/, 1)[0];
          if (first === "scripts") return null;
          return join(config.out, "packs", "BP", bpRel);
        }
        const rpRel = relative(config.packs.rp, abs);
        if (rpRel && !rpRel.startsWith("..") && !rpRel.startsWith(sep + "..")) {
          return join(config.out, "packs", "RP", rpRel);
        }
        return null;
      })();
      const targetDest = deployDestForPackPath(config, targets, path);
      if (distMirror) await rm(distMirror, { force: true });
      if (targetDest) await rm(targetDest, { force: true });
      if (distMirror || targetDest) {
        logger.success(
          `[${timestamp()}] removed ${relative(config.__configDir, path)}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`failed to remove mirror for ${path}: ${message}`);
    }
  };

  packWatcher.on("add", (path: string) => {
    void mirrorPackChange(path, "add");
  });
  packWatcher.on("change", (path: string) => {
    void mirrorPackChange(path, "change");
  });
  packWatcher.on("unlink", (path: string) => {
    void mirrorPackUnlink(path);
  });
  packWatcher.on("error", (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`watcher error: ${message}`);
  });

  // Wait for the watcher's initial scan to complete so we don't race with
  // tests / callers that modify files immediately after deploy() resolves.
  await new Promise<void>((resolveReady) => {
    packWatcher.once("ready", () => resolveReady());
  });

  logger.info("Press Ctrl+C to stop.");

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
