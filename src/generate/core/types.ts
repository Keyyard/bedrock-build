/** The six generator families. SPEC §4. */
export type CreateType =
  | "weapon"
  | "tool"
  | "armor"
  | "item"
  | "entity"
  | "block";

export const CREATE_TYPES: readonly CreateType[] = [
  "weapon",
  "tool",
  "armor",
  "item",
  "entity",
  "block",
];

/**
 * Fully-resolved options for a generator run. The interactive shell and the
 * flag parser both produce this shape; the pure planners consume it. Every
 * field maps to a CLI flag (SPEC §3.4: every prompt has a flag).
 */
export interface CreateOptions {
  /** Which generator to run. Required before dispatch. */
  type?: CreateType;
  /** The feature name (snake_case, pure alphabet + underscore). */
  name?: string;

  // shared
  /** Atlas/texture key source — input `sword` → path `textures/items/sword`. */
  icon?: string;
  /** Display name override (defaults to Title Case of name). */
  displayName?: string;

  // 2d/3d toggle (weapon, entity); armor uses icon|3d
  mode?: string;

  // 3d references (user-imported geometry/texture/animation)
  geometry?: string;
  texture?: string;

  // tool
  variant?: string;
  tier?: string;
  repairItem?: string;

  // armor
  piece?: string;
  protection?: number;

  // weapon / tool
  durability?: number;
  damage?: number;
  enchantValue?: number;

  // block
  renderMethod?: string;
  sound?: string;
  light?: number;

  // run flags
  force?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

/** A single file the generator intends to write, after plan classification. */
export interface PlannedFile {
  /** Pack-relative path with forward slashes (e.g. `BP/items/x.item.json`). */
  relPath: string;
  /** Absolute filesystem path. */
  absPath: string;
  /** The content that would be written. */
  nextContent: string;
  /** Change classification against the current disk state. */
  status: "create" | "skip" | "conflict" | "overwrite";
}

/** Result of running a generator: the planned files plus import reminders. */
export interface GeneratorResult {
  /** Human-readable notes (import reminders, etc.) for the shell to print. */
  notes: string[];
}
