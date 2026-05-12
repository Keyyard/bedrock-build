import { rm } from "node:fs/promises";

import type { BedrockConfig } from "../config.js";
import { buildBundle } from "../bundler.js";
import { copyPackFiles } from "../copier.js";
import { logger } from "../logger.js";

export interface BuildOptions {
  /** Release mode: minified, no sourcemaps. SPEC §5.1. */
  release?: boolean;
  /** Remove `<out>/` before building. SPEC §5.1 step 2. */
  clean?: boolean;
}

/**
 * One-shot build. SPEC §5.1.
 *
 *   1. (Config already loaded by cli.ts.)
 *   2. If --clean, remove `<out>/` recursively.
 *   3. Bundle `<entry>` via esbuild → `<out>/packs/BP/scripts/main.js`.
 *   4. Copy `<packs.bp>/*` (excluding `scripts/`) into `<out>/packs/BP/`.
 *   5. Copy `<packs.rp>/*` into `<out>/packs/RP/`.
 *   6. Log success + elapsed time.
 */
export async function build(
  config: BedrockConfig,
  options: BuildOptions = {},
): Promise<void> {
  const release = options.release ?? false;
  const clean = options.clean ?? false;

  const overallStart = Date.now();
  logger.info(`Building${release ? " (release)" : ""}...`);

  if (clean) {
    logger.debug(`Cleaning ${config.out}`);
    await rm(config.out, { recursive: true, force: true });
  }

  const bundleResult = await buildBundle(config, { release });
  logger.debug(
    `Bundled ${config.entry} → ${bundleResult.outputPath} in ${bundleResult.elapsedMs}ms`,
  );

  await copyPackFiles(config);
  logger.debug(`Copied pack files to ${config.out}/packs/`);

  const elapsed = Date.now() - overallStart;
  logger.success(`Built in ${elapsed}ms (bundle ${bundleResult.elapsedMs}ms)`);
}
