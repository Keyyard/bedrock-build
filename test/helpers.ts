import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, type BedrockConfig } from "../src/config.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_ROOT = join(HERE, "fixtures", "basic-addon");

/**
 * Copy the `basic-addon` fixture to a fresh tmp directory and return the
 * config loaded against that copy. Tests MUST work against this copy — never
 * the source fixture, because builds write into `dist/`.
 */
export async function setupFixture(): Promise<{
  configPath: string;
  config: BedrockConfig;
  root: string;
  cleanup: () => Promise<void>;
}> {
  const tmp = await mkdtemp(join(tmpdir(), "bedrock-build-test-"));
  await cp(FIXTURE_ROOT, tmp, { recursive: true });
  const configPath = join(tmp, "bedrock.config.json");
  const config = await loadConfig(configPath);
  return {
    configPath,
    config,
    root: tmp,
    cleanup: async () => {
      await rm(tmp, { recursive: true, force: true });
    },
  };
}
