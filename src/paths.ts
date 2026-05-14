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
 * Candidate `com.mojang` paths on Windows, in priority order. Mirrors the
 * search list used by Microsoft's official `@minecraft/core-build-tasks`
 * so any install layout it supports also works here.
 */
interface PathCandidate {
  envVar: "APPDATA" | "LOCALAPPDATA";
  sub: string;
  label: string;
}

const CANDIDATES: PathCandidate[] = [
  // Modern Minecraft Bedrock launcher. Most common on new installs.
  {
    envVar: "APPDATA",
    sub: "Minecraft Bedrock/Users/Shared/games/com.mojang",
    label: "Minecraft Bedrock (launcher)",
  },
  {
    envVar: "APPDATA",
    sub: "Minecraft Bedrock Preview/Users/Shared/games/com.mojang",
    label: "Minecraft Bedrock Preview (launcher)",
  },
  // Legacy Microsoft Store UWP packages.
  {
    envVar: "LOCALAPPDATA",
    sub: "Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang",
    label: "Minecraft (Microsoft Store UWP)",
  },
  {
    envVar: "LOCALAPPDATA",
    sub: "Packages/Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe/LocalState/games/com.mojang",
    label: "Minecraft Beta (Microsoft Store UWP)",
  },
  // Education editions.
  {
    envVar: "LOCALAPPDATA",
    sub: "Packages/Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe/LocalState/games/com.mojang",
    label: "Minecraft Education (UWP)",
  },
  {
    envVar: "APPDATA",
    sub: "Minecraft Education Edition/games/com.mojang",
    label: "Minecraft Education (desktop)",
  },
];

/**
 * Fallback: glob `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_*` so an
 * unusual publisher hash or case variant still resolves. Match is
 * case-insensitive since Windows filenames are case-insensitive but
 * `readdir` returns the on-disk case verbatim.
 */
async function findUwpFallback(): Promise<string | undefined> {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;

  const packagesDir = join(localAppData, "Packages");
  if (!(await isDirectory(packagesDir))) return undefined;

  let entries: string[];
  try {
    entries = await readdir(packagesDir);
  } catch {
    return undefined;
  }

  const uwpPrefix = "microsoft.minecraftuwp_";
  for (const name of entries) {
    if (!name.toLowerCase().startsWith(uwpPrefix)) continue;
    const candidate = join(
      packagesDir,
      name,
      "LocalState",
      "games",
      "com.mojang",
    );
    if (await isDirectory(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Locate the Bedrock `com.mojang` directory across the install layouts
 * Microsoft ships today. Tries the priority list first, then a wildcard
 * UWP fallback. Throws `DeployTargetError` (exit code 3) if nothing matches.
 */
async function findRetailComMojang(): Promise<string> {
  if (process.platform !== "win32") {
    throw new DeployTargetError(
      "Retail deploy is Windows-only for v1. Set deploy.target='custom' and deploy.customPath to your Minecraft data directory.",
    );
  }

  const checked: string[] = [];

  for (const c of CANDIDATES) {
    const root = process.env[c.envVar];
    if (!root) continue;
    const path = join(root, c.sub);
    checked.push(`  - ${c.label}: ${path}`);
    if (await isDirectory(path)) return path;
  }

  const fallback = await findUwpFallback();
  if (fallback) return fallback;

  throw new DeployTargetError(
    `Retail deploy: could not locate com.mojang under any known Bedrock install layout. Paths checked:\n${checked.join("\n")}\n\nIf Minecraft is installed in a non-standard location, set deploy.target='custom' and deploy.customPath in bedrock.config.json.`,
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
