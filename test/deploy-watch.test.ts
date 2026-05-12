import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deploy } from "../src/commands/deploy.js";
import type { BedrockConfig } from "../src/config.js";
import { setupFixture } from "./helpers.js";

async function setupDeployFixture(): Promise<{
  config: BedrockConfig;
  root: string;
  target: string;
  cleanup: () => Promise<void>;
}> {
  const base = await setupFixture();
  const target = await mkdtemp(join(tmpdir(), "bedrock-build-deploy-target-"));
  const config: BedrockConfig = {
    ...base.config,
    deploy: { target: "custom", customPath: target },
  };
  return {
    config,
    root: base.root,
    target,
    cleanup: async () => {
      await base.cleanup();
      await rm(target, { recursive: true, force: true });
    },
  };
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

describe("deploy --watch (smoke)", () => {
  let fx: Awaited<ReturnType<typeof setupDeployFixture>>;
  let deployPromise: Promise<void> | null = null;

  beforeEach(async () => {
    fx = await setupDeployFixture();
    deployPromise = null;
  });
  afterEach(async () => {
    if (deployPromise) {
      process.emit("SIGINT");
      try {
        await Promise.race([
          deployPromise,
          new Promise<void>((r) => setTimeout(r, 5000)),
        ]);
      } catch {
        // ignore
      }
    }
    await fx.cleanup();
  });

  it("initial deploy then mirrors a pack file change into the deploy target", async () => {
    deployPromise = deploy(fx.config, { release: false, watch: true });

    // Wait for the initial deploy to populate the target.
    const targetItem = join(
      fx.target,
      "development_behavior_packs",
      fx.config.name,
      "items",
      "example.item.json",
    );
    const initialReady = await waitForCondition(async () => {
      try {
        const s = await stat(targetItem);
        return s.isFile();
      } catch {
        return false;
      }
    });
    expect(initialReady).toBe(true);

    // Modify a pack source file and wait for the mirror to update.
    const srcItem = join(
      fx.root,
      "packs",
      "BP",
      "items",
      "example.item.json",
    );
    const original = await readFile(srcItem, "utf8");
    const updated = original.replace(/}\s*$/, ',"_watched":true}');
    await writeFile(srcItem, updated);

    // Small delay so chokidar's initial scan completes after the initial deploy.
    await new Promise((r) => setTimeout(r, 500));

    // Modify by writing again — make sure to write AFTER chokidar is ready.
    await writeFile(srcItem, updated);

    const mirroredUpdated = await waitForCondition(async () => {
      try {
        const content = await readFile(targetItem, "utf8");
        return content.includes('"_watched":true');
      } catch {
        return false;
      }
    }, 8000);
    expect(mirroredUpdated).toBe(true);
  });
});
