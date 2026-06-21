import * as p from "@clack/prompts";
import pc from "picocolors";

import type { BedrockConfig } from "../config.js";
import { logger } from "../logger.js";
import { Tree } from "../generate/core/tree.js";
import { hasConflict, planTree } from "../generate/core/plan.js";
import { GenerateError } from "../generate/core/errors.js";
import { validateName, validateNamespace } from "../generate/core/identifier.js";
import { toDisplayName } from "../generate/core/names.js";
import {
  CREATE_TYPES,
  type CreateOptions,
  type CreateType,
  type GeneratorResult,
  type PlannedFile,
} from "../generate/core/types.js";
import { planWeapon } from "../generate/weapon.js";
import { planTool } from "../generate/tool.js";
import { planArmor } from "../generate/armor.js";
import { planItem } from "../generate/item.js";
import { planEntity } from "../generate/entity.js";
import { planBlock } from "../generate/block.js";

type Planner = (tree: Tree, config: BedrockConfig, opts: CreateOptions) => GeneratorResult;

const PLANNERS: Record<CreateType, Planner> = {
  weapon: planWeapon,
  tool: planTool,
  armor: planArmor,
  item: planItem,
  entity: planEntity,
  block: planBlock,
};

function isCreateType(v: string): v is CreateType {
  return (CREATE_TYPES as readonly string[]).includes(v);
}

/** Sentinel for a clean clack cancel — caught by `create`, exits 0, no writes. */
class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelledError";
  }
}

/** create-vite-style interactive gate. SPEC §3.4. */
function isCI(): boolean {
  return (
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.CONTINUOUS_INTEGRATION === "true" ||
    process.env.GITHUB_ACTIONS === "true"
  );
}

/** Byte length helper for the plan display. */
function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** Render a single planned-file line, colored by status. */
function planLine(f: PlannedFile): string {
  const size = `${bytes(f.nextContent)} B`;
  switch (f.status) {
    case "create":
      return `  ${pc.green("create")}  ${f.relPath} ${pc.dim(`(${size})`)}`;
    case "overwrite":
      return `  ${pc.yellow("overwrite")}  ${f.relPath} ${pc.dim(`(${size})`)}`;
    case "skip":
      return `  ${pc.dim("skip")}  ${f.relPath} ${pc.dim("(unchanged)")}`;
    case "conflict":
      return `  ${pc.red("conflict")}  ${f.relPath} ${pc.dim("(differs — use --force)")}`;
  }
}

/** Print the change plan to stdout (used by --dry-run and the non-interactive path). */
function printPlan(plan: readonly PlannedFile[]): void {
  for (const f of plan) {
    process.stdout.write(planLine(f) + "\n");
  }
}

/**
 * Build the exact copy-paste one-liner a user should run when a required value
 * is missing in non-interactive mode. SPEC §3.4.
 */
function oneLiner(type: CreateType, opts: CreateOptions): string {
  const parts = [`bedrock-build create ${type}`];
  if (opts.name) parts.push(opts.name);
  else parts.push("<name>");
  return parts.join(" ");
}

/**
 * `create <type> [name]`. Thin interactive shell + dispatch. SPEC §3.4 / §4.
 *
 * - Interactive (TTY, !-y, !CI): a clack p.group() flow with smart defaults.
 * - Non-interactive: flags drive everything; a missing required value errors
 *   with the copy-paste one-liner.
 * - --dry-run prints the plan and writes nothing.
 * - --force overwrites; an unforced conflict aborts before any write.
 */
export async function create(config: BedrockConfig, opts: CreateOptions): Promise<void> {
  const interactive = Boolean(process.stdout.isTTY) && !opts.yes && !isCI();

  // Hard-reject a bad project namespace ONLY here at generate time (SPEC §3.2).
  const nsCheck = validateNamespace(config.namespace);
  if (nsCheck !== true) {
    throw new GenerateError(
      `Project namespace "${config.namespace}" is invalid: ${nsCheck} Set a valid \`bedrock-cli.namespace\` in config.json.`,
    );
  }

  let type = opts.type;
  let resolved: CreateOptions = { ...opts };

  if (interactive) {
    try {
      resolved = await runInteractive(config, opts);
    } catch (err) {
      if (err instanceof CancelledError) return; // benign cancel, exit 0
      throw err;
    }
    type = resolved.type;
  } else {
    // Non-interactive: validate required values up front with a friendly hint.
    if (!type || !isCreateType(type)) {
      throw new GenerateError(
        `Missing or unknown type. Usage: bedrock-build create <${CREATE_TYPES.join("|")}> <name>`,
      );
    }
    if (!resolved.name || resolved.name.trim() === "") {
      throw new GenerateError(
        `A name is required. Run: ${oneLiner(type, resolved)} (e.g. ${oneLiner(type, { ...resolved, name: "fire_sword" })})`,
      );
    }
    const nameCheck = validateName(resolved.name.trim());
    if (nameCheck !== true) throw new GenerateError(nameCheck);
  }

  if (!type || !isCreateType(type)) {
    throw new GenerateError(`Unknown create type "${String(type)}".`);
  }

  // Build the tree (pure planner mutations).
  const tree = new Tree(config.__configDir);
  const result = PLANNERS[type](tree, config, resolved);

  const plan = planTree(tree, Boolean(resolved.force));

  if (resolved.dryRun) {
    if (interactive) p.log.message(pc.bold("Dry run — nothing will be written:"));
    else process.stdout.write(pc.bold("Dry run — nothing will be written:\n"));
    printPlan(plan);
    if (interactive) p.outro(pc.dim("Re-run without --dry-run to apply."));
    else logger.info("Re-run without --dry-run to apply.");
    return;
  }

  if (hasConflict(plan)) {
    if (interactive) {
      p.log.warn(pc.yellow("Conflicts — nothing was written:"));
      plan.filter((f) => f.status === "conflict").forEach((f) => p.log.message(planLine(f)));
      p.cancel("Re-run with --force to overwrite, or --dry-run to preview.");
    } else {
      logger.error("Conflicts — nothing was written:");
      printPlan(plan.filter((f) => f.status === "conflict"));
      logger.error("Re-run with --force to overwrite, or --dry-run to preview.");
    }
    throw new GenerateError("Aborted due to conflicting files (use --force to overwrite).");
  }

  // Flush.
  if (interactive) {
    const s = p.spinner();
    s.start("Writing files");
    await tree.flush();
    s.stop("Files written");
    summarize(plan, true);
    if (result.notes.length > 0) {
      p.note(result.notes.join("\n\n"), "Next steps");
    }
    p.outro(pc.green(`✓ create:${type} ${resolved.name} done`));
  } else {
    await tree.flush();
    summarize(plan, false);
    for (const note of result.notes) logger.info(note);
    logger.success(`create:${type} ${resolved.name} done`);
  }
}

/** Print a one-line summary of what changed. */
function summarize(plan: readonly PlannedFile[], inter: boolean): void {
  const created = plan.filter((f) => f.status === "create").length;
  const overwritten = plan.filter((f) => f.status === "overwrite").length;
  const skipped = plan.filter((f) => f.status === "skip").length;
  const parts: string[] = [];
  if (created) parts.push(`${created} created`);
  if (overwritten) parts.push(`${overwritten} overwritten`);
  if (skipped) parts.push(`${skipped} unchanged`);
  const msg = parts.join(", ") || "no changes";
  if (inter) p.log.success(msg);
  else logger.info(msg);
}

/**
 * Interactive clack flow. Smart defaults let a beginner press Enter through.
 * Only prompts for values not already supplied via flags.
 */
async function runInteractive(
  config: BedrockConfig,
  opts: CreateOptions,
): Promise<CreateOptions> {
  p.intro(pc.cyan("bedrock-build create"));

  let type = opts.type;
  if (!type || !isCreateType(type)) {
    const picked = await p.select({
      message: "What do you want to create?",
      options: CREATE_TYPES.map((t) => ({ value: t, label: t })),
    });
    if (p.isCancel(picked)) cancelOut();
    type = picked as CreateType;
  }

  const name =
    opts.name && opts.name.trim() !== ""
      ? opts.name.trim()
      : await promptName();

  // Per-type prompts. Each falls back to the supplied flag value.
  const out: CreateOptions = { ...opts, type, name };

  switch (type) {
    case "weapon": {
      out.mode = opts.mode ?? (await promptMode("2d"));
      out.icon = opts.icon ?? (await promptText("Icon name", name));
      if ((out.mode ?? "2d").toLowerCase() === "3d") {
        out.geometry =
          opts.geometry ?? (await promptText("Geometry id", `geometry.${config.namespace}.${name}`));
        out.texture =
          opts.texture ??
          (await promptText("Texture path", `textures/${config.namespace}/items/${name}`));
      }
      break;
    }
    case "tool": {
      out.variant = opts.variant ?? (await promptSelect("Tool type", ["pickaxe", "axe", "shovel", "hoe"]));
      out.icon = opts.icon ?? (await promptText("Icon name", name));
      out.tier = opts.tier ?? (await promptSelect("Tier", ["wooden", "stone", "iron", "golden", "diamond"], "diamond"));
      break;
    }
    case "armor": {
      out.piece = opts.piece ?? (await promptSelect("Piece", ["helmet", "chestplate", "leggings", "boots"]));
      out.mode = opts.mode ?? (await promptSelect("Render mode", ["icon", "3d"], "icon"));
      out.icon = opts.icon ?? (await promptText("Icon name", name));
      if ((out.mode ?? "icon").toLowerCase() === "3d") {
        out.geometry =
          opts.geometry ?? (await promptText("Geometry id", `geometry.${config.namespace}.${name}`));
        out.texture =
          opts.texture ??
          (await promptText("Texture path", `textures/${config.namespace}/models/${name}`));
      }
      break;
    }
    case "item": {
      out.icon = opts.icon ?? (await promptText("Icon name", name));
      out.displayName = opts.displayName ?? (await promptText("Display name", toDisplayName(name)));
      break;
    }
    case "entity": {
      out.mode = opts.mode ?? (await promptMode("3d"));
      out.displayName = opts.displayName ?? (await promptText("Display name", toDisplayName(name)));
      if ((out.mode ?? "3d").toLowerCase() === "3d") {
        out.geometry =
          opts.geometry ?? (await promptText("Geometry id", `geometry.${config.namespace}.${name}`));
        out.texture = opts.texture ?? (await promptText("Texture path", `textures/entity/${name}`));
      } else {
        out.texture = opts.texture ?? (await promptText("Texture path", `textures/entity/${name}`));
      }
      break;
    }
    case "block": {
      out.texture = opts.texture ?? (await promptText("Texture key", name));
      out.renderMethod =
        opts.renderMethod ?? (await promptSelect("Render method", ["opaque", "blend", "alpha_test"], "opaque"));
      out.sound = opts.sound ?? (await promptSelect("Sound", ["stone", "wood", "glass", "metal", "sand", "gravel"], "stone"));
      break;
    }
  }

  return out;
}

function cancelOut(): never {
  p.cancel("Cancelled.");
  // A clean abort with no writes. The CancelledError is caught by `create`,
  // which returns normally (exit 0) — a cancel is not a generation failure.
  throw new CancelledError();
}

async function promptName(): Promise<string> {
  const v = await p.text({
    message: "Name (snake_case)",
    placeholder: "fire_sword",
    validate: (s) => {
      const r = validateName((s ?? "").trim());
      return r === true ? undefined : r;
    },
  });
  if (p.isCancel(v)) cancelOut();
  return (v as string).trim();
}

async function promptText(message: string, def: string): Promise<string> {
  const v = await p.text({ message, defaultValue: def, placeholder: def });
  if (p.isCancel(v)) cancelOut();
  const s = (v as string).trim();
  return s === "" ? def : s;
}

async function promptSelect(
  message: string,
  options: string[],
  initial?: string,
): Promise<string> {
  const v = await p.select({
    message,
    options: options.map((o) => ({ value: o, label: o })),
    initialValue: initial,
  });
  if (p.isCancel(v)) cancelOut();
  return v as string;
}

async function promptMode(initial: "2d" | "3d"): Promise<string> {
  return promptSelect("Render", ["2d", "3d"], initial);
}
