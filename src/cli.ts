import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "./commands/build.js";
import { watch } from "./commands/watch.js";
import { deploy } from "./commands/deploy.js";
import { pack } from "./commands/pack.js";
import { folders } from "./commands/folders.js";
import { create } from "./commands/create.js";
import { ConfigError, loadConfig } from "./config.js";
import { DeployTargetError } from "./paths.js";
import { GenerateError } from "./generate/core/errors.js";
import type { CreateType } from "./generate/core/types.js";
import { logger, setVerbose } from "./logger.js";

const KNOWN_COMMANDS = ["build", "watch", "deploy", "pack", "folders", "create"] as const;
type Command = (typeof KNOWN_COMMANDS)[number];

/** Generator flags that are only valid for `create`. SPEC §3.1. */
const GENERATOR_VALUE_FLAGS = [
  "--name",
  "--icon",
  "--geometry",
  "--texture",
  "--mode",
  "--piece",
  "--tier",
  "--variant",
  "--sound",
  "--render-method",
  "--light",
  "--durability",
  "--damage",
  "--protection",
  "--enchant-value",
  "--repair-item",
  "--display-name",
] as const;
const GENERATOR_BOOLEAN_FLAGS = ["--force", "--dry-run", "-y", "--yes"] as const;

interface ParsedArgs {
  command: Command | null;
  configPath: string | undefined;
  verbose: boolean;
  help: boolean;
  version: boolean;
  release: boolean;
  clean: boolean;
  watch: boolean;
  output: string | undefined;

  // create <type> [name] positionals (SPEC §3.1).
  type: string | undefined;
  genName: string | undefined;

  // create value flags (SPEC §3.1).
  name: string | undefined;
  icon: string | undefined;
  geometry: string | undefined;
  texture: string | undefined;
  mode: string | undefined;
  piece: string | undefined;
  tier: string | undefined;
  variant: string | undefined;
  sound: string | undefined;
  renderMethod: string | undefined;
  light: string | undefined;
  durability: string | undefined;
  damage: string | undefined;
  protection: string | undefined;
  enchantValue: string | undefined;
  repairItem: string | undefined;
  displayName: string | undefined;

  // create boolean flags.
  force: boolean;
  dryRun: boolean;
  yes: boolean;

  /** Unknown flags (with leading dashes) collected for error reporting. */
  unknown: string[];
  /** Unknown positionals collected for error reporting. */
  extraPositionals: string[];
}

const HELP_TEXT = `Usage:
  bedrock-build <command> [options]

Commands:
  build               Compile sources and copy packs to dist/
  watch               Build, then rebuild on file changes (no deploy)
  deploy              Build, then copy dist/packs to com.mojang/development_*_packs/
  pack                Build --release, then zip into .mcaddon
  folders             Interactive picker that scaffolds canonical pack folders
  create <type> [name]  Scaffold a fully-wired add-on feature (BP + RP + registries)
                      types: weapon | tool | armor | item | entity | block

Global options:
  -c, --config <path>   Path to config (default: ./config.json, then ./bedrock.config.json)
  -v, --verbose         Verbose logging
  -h, --help            Show help
  --version             Show version

Command flags:
  build  --release            Minified, no sourcemaps, NODE_ENV=production
         --clean              Remove dist/ before building
  watch  (no watch-specific flags for v1)
  deploy --watch              Rebuild and re-deploy on file changes
         --release            Build in release mode before deploying
  pack   --output <path>      Override output .mcaddon path
                              (default: dist/<name>-<version>.mcaddon)
  folders (no flags — interactive)
  create --name <name>        Override/alias for the positional name
         --icon <name>        Icon name (item-family) / texture key
         --mode <2d|3d|icon>  Render mode (weapon/entity: 2d|3d; armor: icon|3d)
         --variant <type>     Tool: pickaxe | axe | shovel | hoe
         --piece <type>       Armor: helmet | chestplate | leggings | boots
         --tier <tier>        Tool tier (default diamond)
         --geometry <id>      3D geometry id (user-imported model)
         --texture <path>     3D texture path / block texture key
         --sound <sound>      Block sound (default stone)
         --render-method <m>  Block render method: opaque | blend | alpha_test
         --light <0-15>       Block light emission
         --durability <n>     Item durability
         --damage <n>         Weapon/tool damage
         --protection <n>     Armor protection
         --enchant-value <n>  Enchantability value
         --repair-item <id>   Repair item identifier
         --display-name <s>   Display name override
         --force              Overwrite conflicting files
         --dry-run            Print the plan, write nothing
         -y, --yes            Accept defaults (non-interactive)
`;

/**
 * Hand-written argv parser. No external dep per SPEC §6.
 *
 * Conventions:
 *   - First non-flag token is the command name.
 *   - Long flags accept either `--flag value` or `--flag=value`.
 *   - Short flag `-c` accepts `-c value` or `-c=value`.
 *   - Boolean flags do not consume the next token.
 *   - Unknown flags / extra positionals are collected and reported.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: null,
    configPath: undefined,
    verbose: false,
    help: false,
    version: false,
    release: false,
    clean: false,
    watch: false,
    output: undefined,
    type: undefined,
    genName: undefined,
    name: undefined,
    icon: undefined,
    geometry: undefined,
    texture: undefined,
    mode: undefined,
    piece: undefined,
    tier: undefined,
    variant: undefined,
    sound: undefined,
    renderMethod: undefined,
    light: undefined,
    durability: undefined,
    damage: undefined,
    protection: undefined,
    enchantValue: undefined,
    repairItem: undefined,
    displayName: undefined,
    force: false,
    dryRun: false,
    yes: false,
    unknown: [],
    extraPositionals: [],
  };

  // Flags that take a value (shared + generator-only).
  const VALUE_FLAGS = new Set<string>([
    "--config",
    "-c",
    "--output",
    ...GENERATOR_VALUE_FLAGS,
  ]);

  // Maps a generator value-flag to its ParsedArgs field. Used both to assign
  // and (post-pass) to know which were generator-only for `create`-scoping.
  const GEN_VALUE_FIELD: Record<string, keyof ParsedArgs> = {
    "--name": "name",
    "--icon": "icon",
    "--geometry": "geometry",
    "--texture": "texture",
    "--mode": "mode",
    "--piece": "piece",
    "--tier": "tier",
    "--variant": "variant",
    "--sound": "sound",
    "--render-method": "renderMethod",
    "--light": "light",
    "--durability": "durability",
    "--damage": "damage",
    "--protection": "protection",
    "--enchant-value": "enchantValue",
    "--repair-item": "repairItem",
    "--display-name": "displayName",
  };

  // Track generator-only flags actually supplied, so we can reject them after
  // the pass when the command turns out not to be `create` (SPEC §3.1).
  const seenGeneratorFlags: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    // Split `--flag=value` form.
    let name = arg;
    let inlineValue: string | undefined;
    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      name = arg.slice(0, eq);
      inlineValue = arg.slice(eq + 1);
    } else if (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      name = arg.slice(0, eq);
      inlineValue = arg.slice(eq + 1);
    }

    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) return undefined;
      i++;
      return next;
    };

    if (name === "--help" || name === "-h") {
      out.help = true;
      continue;
    }
    if (name === "--version") {
      out.version = true;
      continue;
    }
    if (name === "--verbose" || name === "-v") {
      out.verbose = true;
      continue;
    }
    if (name === "--config" || name === "-c") {
      const v = takeValue();
      if (v === undefined) {
        out.unknown.push(`${name} (missing value)`);
      } else {
        out.configPath = v;
      }
      continue;
    }
    if (name === "--release") {
      out.release = true;
      continue;
    }
    if (name === "--clean") {
      out.clean = true;
      continue;
    }
    if (name === "--watch") {
      out.watch = true;
      continue;
    }
    if (name === "--output") {
      const v = takeValue();
      if (v === undefined) {
        out.unknown.push(`${name} (missing value)`);
      } else {
        out.output = v;
      }
      continue;
    }

    // Generator boolean flags.
    if ((GENERATOR_BOOLEAN_FLAGS as readonly string[]).includes(name)) {
      if (name === "--force") out.force = true;
      else if (name === "--dry-run") out.dryRun = true;
      else if (name === "-y" || name === "--yes") out.yes = true;
      seenGeneratorFlags.push(name);
      continue;
    }

    // Generator value flags.
    const genField = GEN_VALUE_FIELD[name];
    if (genField !== undefined) {
      const v = takeValue();
      if (v === undefined) {
        out.unknown.push(`${name} (missing value)`);
      } else {
        (out as unknown as Record<string, string>)[genField] = v;
      }
      seenGeneratorFlags.push(name);
      continue;
    }

    if (name.startsWith("-")) {
      out.unknown.push(name);
      // If it looked like a value-taking flag, consume the next token to keep
      // the rest of the parse coherent.
      if (VALUE_FLAGS.has(name) && inlineValue === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) i++;
      }
      continue;
    }

    // Positional: the first one is the command.
    if (out.command === null) {
      if ((KNOWN_COMMANDS as readonly string[]).includes(arg)) {
        out.command = arg as Command;
      } else {
        out.extraPositionals.push(arg);
      }
      continue;
    }

    // `create` accepts TWO extra positionals: `<type> [name]`. Every other
    // command still rejects any extra positional (SPEC §3.1).
    if (out.command === "create") {
      if (out.type === undefined) {
        out.type = arg;
        continue;
      }
      if (out.genName === undefined) {
        out.genName = arg;
        continue;
      }
    }

    out.extraPositionals.push(arg);
  }

  // Generator-only flags are valid solely for `create`. On any other command,
  // push them to `unknown` so they error instead of being silently swallowed
  // (SPEC §3.1 — otherwise `build --piece chestplate` would mask a typo).
  if (out.command !== "create") {
    for (const flag of seenGeneratorFlags) out.unknown.push(flag);
  }

  return out;
}

async function readPackageVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  // After tsup build, cli.js lives in dist/, so package.json is one level up.
  // During `tsup --watch` from src/ this still finds the same file.
  const candidates = [
    resolve(here, "..", "package.json"),
    resolve(here, "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === "@keyyard/bedrock-build" && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // try the next candidate
    }
  }
  return "0.0.0";
}

function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

/** Parse a numeric flag value; `undefined`/NaN map to undefined (use default). */
function toNum(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Top-level CLI entry point. Parses argv, dispatches to a subcommand, and
 * converts thrown errors into the SPEC §2 exit codes.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.verbose) setVerbose(true);

  if (args.version) {
    const v = await readPackageVersion();
    process.stdout.write(`${v}\n`);
    return 0;
  }

  if (args.help && args.command === null) {
    printHelp();
    return 0;
  }

  if (args.unknown.length > 0) {
    logger.error(`Unknown option(s): ${args.unknown.join(", ")}`);
    printHelp();
    return 1;
  }

  if (args.command === null) {
    if (args.extraPositionals.length > 0) {
      logger.error(`Unknown command: ${args.extraPositionals[0]}`);
      printHelp();
      return 1;
    }
    // No command and no --help: print help and exit 1 (matches usage error).
    printHelp();
    return 1;
  }

  if (args.extraPositionals.length > 0) {
    logger.error(
      `Unexpected positional argument(s) for \`${args.command}\`: ${args.extraPositionals.join(", ")}`,
    );
    printHelp();
    return 1;
  }

  if (args.help) {
    // `<command> --help`. same help text covers all commands.
    printHelp();
    return 0;
  }

  // Load config for the chosen command.
  let config;
  try {
    config = await loadConfig(args.configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(err.message);
      return err.exitCode;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error(message);
    return 1;
  }

  try {
    switch (args.command) {
      case "build":
        await build(config, { release: args.release, clean: args.clean });
        return 0;
      case "watch":
        await watch(config, {});
        return 0;
      case "deploy":
        await deploy(config, { release: args.release, watch: args.watch });
        return 0;
      case "pack":
        await pack(config, args.output ? { output: args.output } : {});
        return 0;
      case "folders":
        await folders(config);
        return 0;
      case "create":
        await create(config, {
          type: args.type as CreateType | undefined,
          name: args.genName ?? args.name,
          icon: args.icon,
          geometry: args.geometry,
          texture: args.texture,
          mode: args.mode,
          piece: args.piece,
          tier: args.tier,
          variant: args.variant,
          sound: args.sound,
          renderMethod: args.renderMethod,
          displayName: args.displayName,
          repairItem: args.repairItem,
          light: toNum(args.light),
          durability: toNum(args.durability),
          damage: toNum(args.damage),
          protection: toNum(args.protection),
          enchantValue: toNum(args.enchantValue),
          force: args.force,
          dryRun: args.dryRun,
          yes: args.yes,
        });
        return 0;
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(err.message);
      return err.exitCode;
    }
    if (err instanceof DeployTargetError) {
      logger.error(err.message);
      return err.exitCode;
    }
    if (err instanceof GenerateError) {
      logger.error(err.message);
      return err.exitCode;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error(message);
    return 1;
  }
}

// Run only when invoked directly (not when imported). Compare normalized URLs
// to be robust against Windows path quirks.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`.replace(
    "file:///",
    "file:///",
  );

if (
  invokedDirectly ||
  // Fallback: tsup-bundled bin is always the entry, so just run.
  process.argv[1]?.endsWith("cli.js") ||
  process.argv[1]?.endsWith("bedrock-build")
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.stack ?? err.message : String(err);
      logger.error(message);
      process.exit(1);
    });
}
