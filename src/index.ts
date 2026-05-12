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

export { loadConfig, validateConfig, ConfigError } from "./config.js";
export type { BedrockConfig } from "./config.js";

export { resolveDeployTarget, DeployTargetError } from "./paths.js";
export type { DeployTargets } from "./paths.js";

export { logger, setVerbose } from "./logger.js";
