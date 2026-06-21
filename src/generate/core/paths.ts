import { relative } from "node:path";

import type { BedrockConfig } from "../../config.js";

/**
 * Tree-relative (forward-slash) pack roots, anchored at the config dir (the
 * Tree root). Generators write into `<bpRel>/...` and `<rpRel>/...`. SPEC §3.2:
 * targets come ONLY from the absolute config paths, never cwd.
 */
export interface PackRoots {
  bpRel: string;
  rpRel: string;
}

export function packRoots(config: BedrockConfig): PackRoots {
  const bpRel = relative(config.__configDir, config.packs.bp).replace(/\\/g, "/");
  const rpRel = relative(config.__configDir, config.packs.rp).replace(/\\/g, "/");
  return { bpRel, rpRel };
}
