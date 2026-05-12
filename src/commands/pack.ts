import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import archiver from "archiver";

import type { BedrockConfig } from "../config.js";
import { build } from "./build.js";
import { logger } from "../logger.js";

export interface PackOptions {
  /** Override output .mcaddon path. Default: `<out>/<name>-<version>.mcaddon`. */
  output?: string;
}

/**
 * Error subclass tagged with SPEC §2 exit code 4 (pack failure).
 */
class PackError extends Error {
  readonly exitCode = 4;
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

/** Pretty-print a byte size in KB or MB. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Build (release) then zip into a `.mcaddon`. SPEC §5.4.
 *
 *   1. Run `build` in release mode (clean: false).
 *   2. Zip `<out>/packs/BP/` and `<out>/packs/RP/` into
 *      `<name>_BP/` and `<name>_RP/` subfolders inside the archive.
 *   3. Write to `--output` if given, else `<out>/<name>-<version>.mcaddon`.
 *   4. Log path + file size.
 */
export async function pack(
  config: BedrockConfig,
  options: PackOptions = {},
): Promise<void> {
  // Step 1: build in release mode.
  await build(config, { release: true, clean: false });

  // Step 2/3: resolve output path.
  const defaultOutput = join(config.out, `${config.name}-${config.version}.mcaddon`);
  const outputPath = options.output
    ? isAbsolute(options.output)
      ? options.output
      : resolve(config.__configDir, options.output)
    : defaultOutput;

  await mkdir(dirname(outputPath), { recursive: true });

  const bpSrc = join(config.out, "packs", "BP");
  const rpSrc = join(config.out, "packs", "RP");

  logger.info(`Packing ${config.name}-${config.version}.mcaddon...`);

  await zipPacks(outputPath, bpSrc, rpSrc, `${config.name}_BP`, `${config.name}_RP`);

  const finalStat = await stat(outputPath);
  logger.success(`Packed ${outputPath} (${formatBytes(finalStat.size)})`);
}

/**
 * Run archiver to produce the zip. Wraps the stream-based API in a Promise.
 */
function zipPacks(
  outputPath: string,
  bpSrc: string,
  rpSrc: string,
  bpDirInZip: string,
  rpDirInZip: string,
): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    let settled = false;
    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      if (err) rejectPromise(err);
      else resolvePromise();
    };

    output.on("close", () => settle(null));
    output.on("error", (err: Error) => settle(new PackError(`Failed to write archive: ${err.message}`)));

    archive.on("warning", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        logger.warn(`archiver: ${err.message}`);
      } else {
        settle(new PackError(`archiver warning: ${err.message}`));
      }
    });
    archive.on("error", (err: Error) => settle(new PackError(`archiver error: ${err.message}`)));

    archive.pipe(output);

    // The third argument to `.directory()` is the destination name inside the
    // archive — yielding `<name>_BP/...` and `<name>_RP/...` entries.
    archive.directory(bpSrc, bpDirInZip);
    archive.directory(rpSrc, rpDirInZip);

    archive.finalize().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      settle(new PackError(`Failed to finalize archive: ${message}`));
    });
  });
}
