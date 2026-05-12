import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BedrockConfig } from "./config.js";

export interface DeployTargets {
  /** Absolute path to `<comMojang>/development_behavior_packs/<name>/`. */
  bp: string;
  /** Absolute path to `<comMojang>/development_resource_packs/<name>/`. */
  rp: string;
  /** Absolute path to the resolved `com.mojang` (or custom) root directory. */
  root: string;
}

export class DeployTargetError extends Error {
  readonly exitCode = 3;
  constructor(message: string) {
    super(message);
    this.name = "DeployTargetError";
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * On Windows, locate the retail Bedrock data root by globbing
 * `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_*\LocalState\games\com.mojang\`.
 * Returns the first match.
 */
async function findRetailComMojang(): Promise<string> {
  if (process.platform !== "win32") {
    throw new DeployTargetError(
      "Retail deploy is Windows-only for v1.0. Use deploy.target='custom' instead.",
    );
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new DeployTargetError(
      "Retail deploy: %LOCALAPPDATA% is not set; cannot locate the Minecraft UWP package directory.",
    );
  }

  const packagesDir = join(localAppData, "Packages");
  if (!(await isDirectory(packagesDir))) {
    throw new DeployTargetError(
      `Retail deploy: Packages directory not found at ${packagesDir}.`,
    );
  }

  let entries: string[];
  try {
    entries = await readdir(packagesDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DeployTargetError(
      `Retail deploy: failed to read ${packagesDir}: ${message}`,
    );
  }

  const candidates = entries.filter((name) =>
    name.startsWith("Microsoft.MinecraftUWP_"),
  );

  for (const pkg of candidates) {
    const candidate = join(
      packagesDir,
      pkg,
      "LocalState",
      "games",
      "com.mojang",
    );
    if (await isDirectory(candidate)) {
      return candidate;
    }
  }

  throw new DeployTargetError(
    "Retail deploy: could not locate com.mojang under any Microsoft.MinecraftUWP_* package. Is Minecraft for Windows installed?",
  );
}

/**
 * Resolve the deploy root and per-pack target directories per SPEC §5.3.
 *
 * Returns absolute paths to:
 *   - `<comMojang>/development_behavior_packs/<name>/`
 *   - `<comMojang>/development_resource_packs/<name>/`
 *
 * Throws `DeployTargetError` (exit code 3) if the root cannot be located.
 */
export async function resolveDeployTarget(
  config: BedrockConfig,
): Promise<DeployTargets> {
  let root: string;

  if (config.deploy.target === "custom") {
    if (!config.deploy.customPath || config.deploy.customPath.trim() === "") {
      throw new DeployTargetError(
        'Deploy target "custom" requires `deploy.customPath` to be a non-empty string.',
      );
    }
    root = resolve(config.deploy.customPath);
    if (!(await isDirectory(root))) {
      throw new DeployTargetError(
        `Deploy target not found: custom path ${root} does not exist as a directory.`,
      );
    }
  } else {
    root = await findRetailComMojang();
  }

  return {
    root,
    bp: join(root, "development_behavior_packs", config.name),
    rp: join(root, "development_resource_packs", config.name),
  };
}
