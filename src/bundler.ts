import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import esbuild, { type BuildContext, type BuildOptions as EsbuildOptions } from "esbuild";

import type { BedrockConfig } from "./config.js";
import { logger } from "./logger.js";

/** Modules that must NOT be bundled — Minecraft provides them at runtime. */
const MINECRAFT_EXTERNALS = [
  "@minecraft/server",
  "@minecraft/server-ui",
  "@minecraft/server-net",
  "@minecraft/server-admin",
  "@minecraft/server-gametest",
];

export interface BuildOptions {
  /** Dev mode vs release mode. Release: minified, no sourcemaps. */
  release: boolean;
}

export interface BuildResult {
  /** Wall-clock elapsed time, in milliseconds. */
  elapsedMs: number;
  /** Absolute path to the emitted bundle (`<out>/packs/BP/scripts/main.js`). */
  outputPath: string;
}

/**
 * Compute the absolute output path for the script bundle. The entry is
 * always emitted to `<out>/packs/BP/scripts/main.js` per SPEC §5.1.
 */
function outputPathFor(config: BedrockConfig): string {
  return join(config.out, "packs", "BP", "scripts", "main.js");
}

/**
 * Build a shared esbuild option block from a `BedrockConfig` + `BuildOptions`.
 */
function makeEsbuildOptions(
  config: BedrockConfig,
  options: BuildOptions,
  outputPath: string,
): EsbuildOptions {
  return {
    entryPoints: [config.entry],
    outfile: outputPath,
    target: "es2020",
    format: "esm",
    platform: "neutral",
    bundle: true,
    external: [...MINECRAFT_EXTERNALS],
    sourcemap: options.release ? false : "inline",
    minify: options.release,
    logLevel: "silent",
  };
}

/**
 * Format a list of esbuild messages into a single human-readable string.
 */
function formatMessages(
  messages: { text: string; location?: { file: string; line: number; column: number } | null }[],
): string {
  return messages
    .map((m) => {
      if (m.location) {
        return `${m.location.file}:${m.location.line}:${m.location.column}: ${m.text}`;
      }
      return m.text;
    })
    .join("\n");
}

/**
 * One-shot build. SPEC §5.1 step 3.
 *
 * Resolves the entry against `config.__configDir` (handled by the config
 * loader — `config.entry` is already absolute), runs esbuild, and returns
 * timing + output path. Throws on build failure.
 */
export async function buildBundle(
  config: BedrockConfig,
  options: BuildOptions,
): Promise<BuildResult> {
  const outputPath = outputPathFor(config);
  await mkdir(dirname(outputPath), { recursive: true });

  const start = Date.now();
  try {
    const result = await esbuild.build(makeEsbuildOptions(config, options, outputPath));
    if (result.warnings.length > 0) {
      logger.warn(`esbuild: ${formatMessages(result.warnings)}`);
    }
  } catch (err) {
    // esbuild throws a BuildFailure with `.errors` populated.
    const failure = err as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] };
    if (failure && Array.isArray(failure.errors) && failure.errors.length > 0) {
      logger.error(`esbuild: ${formatMessages(failure.errors)}`);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`esbuild: ${message}`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  return {
    elapsedMs: Date.now() - start,
    outputPath,
  };
}

/**
 * Watch mode. SPEC §5.2 / §5.3 (deploy --watch).
 *
 * Starts an esbuild watch context, performs the initial build, and calls
 * `onRebuild` after every successful rebuild (including the first). Returns
 * a disposer that tears down the context.
 *
 * Rebuild errors are logged via `logger.error` and skipped — watch must not
 * crash on a transient build break.
 */
export async function buildBundleWithWatch(
  config: BedrockConfig,
  options: BuildOptions,
  onRebuild: (result: BuildResult) => void | Promise<void>,
): Promise<{ dispose: () => Promise<void> }> {
  const outputPath = outputPathFor(config);
  await mkdir(dirname(outputPath), { recursive: true });

  const baseOptions = makeEsbuildOptions(config, options, outputPath);

  // esbuild's watch context emits a plugin's `onEnd` after every rebuild. We
  // use that to hand control back to the caller.
  let context: BuildContext | null = null;
  let lastBuildStart = Date.now();

  const optionsWithPlugin: EsbuildOptions = {
    ...baseOptions,
    plugins: [
      {
        name: "bedrock-build-watch-notify",
        setup(plugin) {
          plugin.onStart(() => {
            lastBuildStart = Date.now();
          });
          plugin.onEnd(async (result) => {
            if (result.errors.length > 0) {
              logger.error(`esbuild: ${formatMessages(result.errors)}`);
              return;
            }
            if (result.warnings.length > 0) {
              logger.warn(`esbuild: ${formatMessages(result.warnings)}`);
            }
            try {
              await onRebuild({
                elapsedMs: Date.now() - lastBuildStart,
                outputPath,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              logger.error(`onRebuild callback failed: ${message}`);
            }
          });
        },
      },
    ],
  };

  context = await esbuild.context(optionsWithPlugin);
  await context.watch();

  return {
    dispose: async () => {
      if (context) {
        await context.dispose();
        context = null;
      }
    },
  };
}
