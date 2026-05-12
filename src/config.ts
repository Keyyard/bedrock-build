import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * Schema for `bedrock.config.json`. See SPEC §3.
 */
export interface BedrockConfig {
  /** Project name, used for .mcaddon filename and manifest header.name */
  name: string;

  /** Project version, used for .mcaddon filename. Must be valid semver. */
  version: string;

  /** Pack source directories (resolved to absolute paths after loading). */
  packs: {
    bp: string;
    rp: string;
  };

  /** TS entry point for the script module (resolved to absolute path). */
  entry: string;

  /** Build output directory (resolved to absolute path). */
  out: string;

  /** Deploy configuration. */
  deploy: {
    target: "retail" | "custom";
    customPath: string | null;
  };

  /** Optional Minecraft scripting API target hints. */
  minecraft?: {
    serverVersion?: string;
  };

  /**
   * Absolute directory containing the config file. Used by callers that
   * need to resolve paths the same way the loader did.
   */
  __configDir: string;
}

/**
 * Shape of a config object as it appears on disk before defaults / validation.
 * All fields are optional except `name` and `version`.
 */
interface RawBedrockConfig {
  name?: unknown;
  version?: unknown;
  packs?: {
    bp?: unknown;
    rp?: unknown;
  };
  entry?: unknown;
  out?: unknown;
  deploy?: {
    target?: unknown;
    customPath?: unknown;
  };
  minecraft?: {
    serverVersion?: unknown;
  };
}

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Error subclass tagged with a CLI exit code. SPEC §2 exit codes.
 */
export class ConfigError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "ConfigError";
    this.exitCode = exitCode;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathIsDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function pathIsFile(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function resolveRel(base: string, p: string): string {
  return isAbsolute(p) ? p : resolve(base, p);
}

/**
 * Apply SPEC §3 defaults to a raw config object and return a fully-populated
 * BedrockConfig with absolute paths. Validation against the filesystem is a
 * separate step (see `validateConfig`).
 */
function applyDefaults(raw: RawBedrockConfig, configDir: string): BedrockConfig {
  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    throw new ConfigError(
      "Config validation failed: `name` is required and must be a non-empty string.",
      2,
    );
  }
  if (typeof raw.version !== "string" || raw.version.trim() === "") {
    throw new ConfigError(
      "Config validation failed: `version` is required and must be a non-empty string.",
      2,
    );
  }

  const packsRaw = isPlainObject(raw.packs) ? raw.packs : {};
  const bp =
    typeof packsRaw.bp === "string" && packsRaw.bp.trim() !== ""
      ? packsRaw.bp
      : "packs/BP";
  const rp =
    typeof packsRaw.rp === "string" && packsRaw.rp.trim() !== ""
      ? packsRaw.rp
      : "packs/RP";

  const entry =
    typeof raw.entry === "string" && raw.entry.trim() !== "" ? raw.entry : "src/main.ts";
  const out =
    typeof raw.out === "string" && raw.out.trim() !== "" ? raw.out : "dist";

  const deployRaw = isPlainObject(raw.deploy) ? raw.deploy : {};
  const targetRaw = deployRaw.target;
  let target: "retail" | "custom";
  if (targetRaw === undefined) {
    target = "retail";
  } else if (targetRaw === "retail" || targetRaw === "custom") {
    target = targetRaw;
  } else {
    throw new ConfigError(
      `Config validation failed: \`deploy.target\` must be "retail" or "custom" (got ${JSON.stringify(targetRaw)}).`,
      2,
    );
  }

  let customPath: string | null = null;
  if (deployRaw.customPath !== undefined && deployRaw.customPath !== null) {
    if (typeof deployRaw.customPath !== "string") {
      throw new ConfigError(
        "Config validation failed: `deploy.customPath` must be a string or null.",
        2,
      );
    }
    customPath = deployRaw.customPath;
  }

  let minecraft: BedrockConfig["minecraft"];
  if (isPlainObject(raw.minecraft)) {
    const sv = raw.minecraft.serverVersion;
    if (sv !== undefined && typeof sv !== "string") {
      throw new ConfigError(
        "Config validation failed: `minecraft.serverVersion` must be a string.",
        2,
      );
    }
    minecraft = sv === undefined ? {} : { serverVersion: sv };
  }

  return {
    name: raw.name,
    version: raw.version,
    packs: {
      bp: resolveRel(configDir, bp),
      rp: resolveRel(configDir, rp),
    },
    entry: resolveRel(configDir, entry),
    out: resolveRel(configDir, out),
    deploy: {
      target,
      customPath:
        customPath !== null && customPath !== ""
          ? resolveRel(configDir, customPath)
          : customPath,
    },
    ...(minecraft ? { minecraft } : {}),
    __configDir: configDir,
  };
}

/**
 * Validate a defaults-applied config against the filesystem and SPEC §3 rules.
 * Throws `ConfigError` (exit code 2) on validation failure.
 */
export async function validateConfig(config: BedrockConfig): Promise<void> {
  if (!SEMVER_RE.test(config.version)) {
    throw new ConfigError(
      `Config validation failed: \`version\` (${JSON.stringify(config.version)}) is not valid semver.`,
      2,
    );
  }

  if (!(await pathIsDirectory(config.packs.bp))) {
    throw new ConfigError(
      `Config validation failed: \`packs.bp\` does not exist as a directory (${config.packs.bp}).`,
      2,
    );
  }
  if (!(await pathIsDirectory(config.packs.rp))) {
    throw new ConfigError(
      `Config validation failed: \`packs.rp\` does not exist as a directory (${config.packs.rp}).`,
      2,
    );
  }

  if (!(await pathIsFile(resolve(config.packs.bp, "manifest.json")))) {
    throw new ConfigError(
      `Config validation failed: \`packs.bp\` is missing manifest.json (${config.packs.bp}).`,
      2,
    );
  }
  if (!(await pathIsFile(resolve(config.packs.rp, "manifest.json")))) {
    throw new ConfigError(
      `Config validation failed: \`packs.rp\` is missing manifest.json (${config.packs.rp}).`,
      2,
    );
  }

  if (!(await pathIsFile(config.entry))) {
    throw new ConfigError(
      `Config validation failed: \`entry\` does not exist as a file (${config.entry}).`,
      2,
    );
  }

  if (config.deploy.target === "custom") {
    if (!config.deploy.customPath || config.deploy.customPath.trim() === "") {
      throw new ConfigError(
        'Config validation failed: `deploy.customPath` is required when `deploy.target === "custom"`.',
        2,
      );
    }
  }
}

/**
 * Load `bedrock.config.json` from `path` (defaults to `./bedrock.config.json`
 * relative to cwd), apply SPEC §3 defaults, and validate against the filesystem.
 */
export async function loadConfig(path?: string): Promise<BedrockConfig> {
  const configPath = path
    ? isAbsolute(path)
      ? path
      : resolve(process.cwd(), path)
    : resolve(process.cwd(), "bedrock.config.json");

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Could not read config file at ${configPath}: ${message}`,
      1,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Failed to parse ${configPath} as JSON: ${message}`,
      2,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ConfigError(
      `Config at ${configPath} must be a JSON object.`,
      2,
    );
  }

  const configDir = dirname(configPath);
  const withDefaults = applyDefaults(parsed as RawBedrockConfig, configDir);
  await validateConfig(withDefaults);
  return withDefaults;
}
