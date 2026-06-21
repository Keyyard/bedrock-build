/**
 * Programmatic API for `@keyyard/bedrock-build`. See SPEC §10.
 *
 * ```ts
 * import { build, watch, deploy, pack, loadConfig } from "@keyyard/bedrock-build";
 * const config = await loadConfig("./bedrock.config.json");
 * await build(config, { release: false, clean: true });
 * ```
 */

export { build } from "./commands/build.js";
export type { BuildOptions } from "./commands/build.js";

export { buildBundle, buildBundleWithWatch } from "./bundler.js";
export type {
  BuildOptions as BundleBuildOptions,
  BuildResult,
} from "./bundler.js";

export { copyPackFiles, copyPackFile } from "./copier.js";

export { watch } from "./commands/watch.js";
export type { WatchOptions } from "./commands/watch.js";

export { deploy } from "./commands/deploy.js";
export type { DeployOptions } from "./commands/deploy.js";

export { pack } from "./commands/pack.js";
export type { PackOptions } from "./commands/pack.js";

export {
  folders,
  listFolderOptions,
  createFolders,
  BP_FOLDERS,
  RP_FOLDERS,
} from "./commands/folders.js";
export type { FolderDef, FolderOption } from "./commands/folders.js";

export { create } from "./commands/create.js";

export { GenerateError } from "./generate/core/errors.js";
export type {
  CreateType,
  CreateOptions,
  GeneratorResult,
  PlannedFile,
} from "./generate/core/types.js";
export { CREATE_TYPES } from "./generate/core/types.js";

export { planWeapon } from "./generate/weapon.js";
export { planTool } from "./generate/tool.js";
export { planArmor } from "./generate/armor.js";
export { planItem } from "./generate/item.js";
export { planEntity } from "./generate/entity.js";
export { planBlock } from "./generate/block.js";

export { Tree } from "./generate/core/tree.js";
export { planTree, hasConflict } from "./generate/core/plan.js";
export {
  validateName,
  validateIdentifier,
  validateNamespace,
  deriveNamespace,
} from "./generate/core/identifier.js";
export { deriveNames, toDisplayName, stripPng } from "./generate/core/names.js";
export {
  mergeItemTexture,
  mergeTerrainTexture,
  mergeBlocks,
  mergeLang,
  ensureLanguages,
} from "./generate/core/registries.js";

export { loadConfig, validateConfig, ConfigError } from "./config.js";
export type { BedrockConfig } from "./config.js";

export { resolveDeployTarget, DeployTargetError } from "./paths.js";
export type { DeployTargets } from "./paths.js";

export { logger, setVerbose } from "./logger.js";
