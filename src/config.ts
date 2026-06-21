import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { deriveNamespace, validateNamespace } from "./generate/core/identifier.js";
import { logger } from "./logger.js";

/**
 * Internal, normalized config shape used by every command. Both the legacy
 * `bedrock.config.json` schema (SPEC §3) and the Bedrock-OSS Project Config
 * Standard shape are normalized into this. See `normalizeRaw`.
 */
export interface BedrockConfig {
  /** Project name, used for .mcaddon filename and manifest header.name */
  name: string;

  /**
   * Bedrock namespace for generated identifiers (`create:*`). SPEC §3.2:
   * optional in config; when absent or malformed it is derived from
   * `sanitize(name)` with a warning (NON-FATAL — never breaks build/watch/deploy
   * for existing 2.x projects). A bad namespace is hard-rejected only at
   * generate time, inside `create`.
   */
  namespace: string;

  /**
   * Project version, used for the .mcaddon filename. Must be valid semver.
   * Sourced from `bedrock-cli.version` / legacy top-level `version`, falling
   * back to the project's `package.json` version, then `"0.0.0"`.
   */
  version: string;

  /** Pack source directories (resolved to absolute paths after loading). */
  packs: {
    bp: string;
    rp: string;
  };

  /** TS or JS entry point for the script module (resolved to absolute path). */
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
 * Flat, legacy-shaped intermediate produced by `normalizeRaw`. Both on-disk
 * schemas collapse to this before defaults / validation run. All fields are
 * optional here; `applyDefaults` fills the gaps.
 */
interface RawBedrockConfig {
  name?: unknown;
  namespace?: unknown;
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

/** Return the first argument that is not `undefined`. */
function pick(...vals: unknown[]): unknown {
  for (const v of vals) {
    if (v !== undefined) return v;
  }
  return undefined;
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
 * Collapse either on-disk schema into the flat `RawBedrockConfig` intermediate.
 *
 * Standard (Bedrock-OSS Project Config Standard) shape:
 *   - top-level `name`, `targetVersion`
 *   - `packs.behaviorPack` / `packs.resourcePack`
 *   - compiler settings under a `bedrock-cli` namespace:
 *       `bedrock-cli.{version,entry,out,deploy}`
 *
 * Legacy shape (SPEC §3):
 *   - top-level `name`, `version`, `entry`, `out`, `deploy`
 *   - `packs.bp` / `packs.rp`
 *   - `minecraft.serverVersion`
 *
 * Standard locations win over legacy when both are present, so a file may mix
 * shapes during migration without surprises.
 */
function normalizeRaw(parsed: Record<string, unknown>): RawBedrockConfig {
  const ns: Record<string, unknown> = isPlainObject(parsed["bedrock-cli"])
    ? parsed["bedrock-cli"]
    : {};
  const packs: Record<string, unknown> = isPlainObject(parsed.packs)
    ? parsed.packs
    : {};
  const legacyMc: Record<string, unknown> = isPlainObject(parsed.minecraft)
    ? parsed.minecraft
    : {};

  // deploy: namespace (standard) takes precedence over top-level (legacy).
  const deployRaw = isPlainObject(ns.deploy)
    ? ns.deploy
    : isPlainObject(parsed.deploy)
      ? parsed.deploy
      : undefined;

  // serverVersion hint: standard `targetVersion` -> legacy `minecraft.serverVersion`.
  const serverVersion = pick(parsed.targetVersion, legacyMc.serverVersion);

  return {
    name: parsed.name,
    namespace: ns.namespace,
    version: pick(ns.version, parsed.version),
    packs: {
      bp: pick(packs.behaviorPack, packs.bp),
      rp: pick(packs.resourcePack, packs.rp),
    },
    entry: pick(ns.entry, parsed.entry),
    out: pick(ns.out, parsed.out),
    deploy: deployRaw as RawBedrockConfig["deploy"],
    minecraft:
      serverVersion !== undefined
        ? { serverVersion }
        : undefined,
  };
}

/**
 * Apply defaults to a normalized config and return a fully-populated
 * BedrockConfig with absolute paths. Filesystem validation is a separate step
 * (see `validateConfig`). `version` and `entry` are expected to already be
 * resolved by `loadConfig` before this runs.
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

  // Namespace is generator-only data and MUST be non-fatal here (SPEC §3.2):
  // a 2.x project that omits it, or supplies a malformed one, must still
  // build/watch/deploy. Validate-or-derive with a warn; never throw.
  let namespace: string;
  if (raw.namespace === undefined || raw.namespace === null) {
    namespace = deriveNamespace(raw.name);
  } else if (typeof raw.namespace === "string" && validateNamespace(raw.namespace) === true) {
    namespace = raw.namespace;
  } else {
    namespace = deriveNamespace(raw.name);
    logger.warn(
      `\`bedrock-cli.namespace\` (${JSON.stringify(raw.namespace)}) is invalid; using derived "${namespace}" instead.`,
    );
  }

  let minecraft: BedrockConfig["minecraft"];
  if (isPlainObject(raw.minecraft)) {
    const sv = raw.minecraft.serverVersion;
    if (sv !== undefined && typeof sv !== "string") {
      throw new ConfigError(
        "Config validation failed: `minecraft.serverVersion` (or `targetVersion`) must be a string.",
        2,
      );
    }
    minecraft = sv === undefined ? {} : { serverVersion: sv };
  }

  return {
    name: raw.name,
    namespace,
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
 * Resolve the project version when the config omits it (the standard config
 * shape has no project-version field, only `targetVersion` for the MC API):
 * `<configDir>/package.json` version, falling back to `"0.0.0"`.
 */
async function resolveProjectVersion(
  rawVersion: unknown,
  configDir: string,
): Promise<string> {
  if (typeof rawVersion === "string" && rawVersion.trim() !== "") {
    return rawVersion;
  }
  try {
    const pkgRaw = await readFile(resolve(configDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.trim() !== "") {
      return pkg.version;
    }
  } catch {
    // No package.json or unreadable: fall through to the default.
  }
  return "0.0.0";
}

/**
 * Resolve the default entry when the config omits it. Probes `src/main.ts`
 * then `src/main.js`, returning whichever exists (absolute). Falls back to the
 * canonical `src/main.ts` so validation reports a clear, expected path.
 */
async function resolveDefaultEntry(configDir: string): Promise<string> {
  const ts = resolve(configDir, "src", "main.ts");
  if (await pathIsFile(ts)) return ts;
  const js = resolve(configDir, "src", "main.js");
  if (await pathIsFile(js)) return js;
  return ts;
}

/**
 * Heuristic: does this JSON file look like a Bedrock config? `config.json` is a
 * generic filename other tools use, so only treat it as ours when it carries a
 * recognizable marker.
 */
async function looksLikeBedrockConfig(filePath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isPlainObject(parsed)) return false;
    if (parsed.type === "minecraftBedrock") return true;
    if ("bedrock-cli" in parsed) return true;
    if (isPlainObject(parsed.packs)) {
      const p = parsed.packs;
      if ("behaviorPack" in p || "resourcePack" in p || "bp" in p || "rp" in p) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Pick the config file to load. An explicit `path` is honored verbatim.
 * Otherwise probe the cwd: prefer the standard `config.json` (interop with
 * bridge/Regolith/Lantern) when it exists and looks like a Bedrock config,
 * else the legacy `bedrock.config.json`.
 */
async function resolveConfigPath(path?: string): Promise<string> {
  if (path) {
    return isAbsolute(path) ? path : resolve(process.cwd(), path);
  }

  const cwd = process.cwd();
  const standard = resolve(cwd, "config.json");
  const legacy = resolve(cwd, "bedrock.config.json");

  const standardExists = await pathIsFile(standard);
  const legacyExists = await pathIsFile(legacy);

  if (standardExists && legacyExists) {
    return (await looksLikeBedrockConfig(standard)) ? standard : legacy;
  }
  if (standardExists) return standard;
  if (legacyExists) return legacy;
  // Neither present: report against the standard path.
  return standard;
}

/** Read + JSON-parse a config file into a plain object. Throws `ConfigError`. */
async function readConfigObject(configPath: string): Promise<Record<string, unknown>> {
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
    throw new ConfigError(`Failed to parse ${configPath} as JSON: ${message}`, 2);
  }

  if (!isPlainObject(parsed)) {
    throw new ConfigError(`Config at ${configPath} must be a JSON object.`, 2);
  }

  return parsed;
}

/**
 * Load a Bedrock config, apply defaults, and validate against the filesystem.
 *
 * `path` is honored verbatim when given. Otherwise the cwd is probed for
 * `config.json` (standard) then `bedrock.config.json` (legacy). Both on-disk
 * schemas are accepted and normalized.
 */
export async function loadConfig(path?: string): Promise<BedrockConfig> {
  const configPath = await resolveConfigPath(path);
  const parsed = await readConfigObject(configPath);
  const configDir = dirname(configPath);

  const flat = normalizeRaw(parsed);
  flat.version = await resolveProjectVersion(flat.version, configDir);
  if (!(typeof flat.entry === "string" && flat.entry.trim() !== "")) {
    flat.entry = await resolveDefaultEntry(configDir);
  }

  const withDefaults = applyDefaults(flat, configDir);
  await validateConfig(withDefaults);
  return withDefaults;
}
