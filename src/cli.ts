import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "./commands/build.js";
import { watch } from "./commands/watch.js";
import { deploy } from "./commands/deploy.js";
import { pack } from "./commands/pack.js";
import { ConfigError, loadConfig } from "./config.js";
import { DeployTargetError } from "./paths.js";
import { logger, setVerbose } from "./logger.js";

const KNOWN_COMMANDS = ["build", "watch", "deploy", "pack"] as const;
type Command = (typeof KNOWN_COMMANDS)[number];

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

Global options:
  -c, --config <path>   Path to bedrock.config.json (default: ./bedrock.config.json)
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
function parseArgs(argv: readonly string[]): ParsedArgs {
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
    unknown: [],
    extraPositionals: [],
  };

  // Flags that take a value.
  const VALUE_FLAGS = new Set(["--config", "-c", "--output"]);

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

    out.extraPositionals.push(arg);
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
