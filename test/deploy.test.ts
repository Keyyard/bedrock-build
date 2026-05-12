import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deploy } from "../src/commands/deploy.js";
import { DeployTargetError } from "../src/paths.js";
import type { BedrockConfig } from "../src/config.js";
import { setupFixture } from "./helpers.js";

/**
 * Spin up a fresh fixture, then point its `deploy.customPath` at a fresh
 * tmpdir so the tests never touch the real com.mojang directory.
 */
async function setupDeployFixture(): Promise<{
  config: BedrockConfig;
  root: string;
  target: string;
  cleanup: () => Promise<void>;
}> {
  const base = await setupFixture();
  const target = await mkdtemp(join(tmpdir(), "bedrock-build-deploy-target-"));
  // Override the config in-memory: the loader resolved customPath already.
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

describe("deploy command (one-shot)", () => {
  let fx: Awaited<ReturnType<typeof setupDeployFixture>>;

  beforeEach(async () => {
    fx = await setupDeployFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  it("populates development_behavior_packs and development_resource_packs", async () => {
    await deploy(fx.config, { release: false, watch: false });

    const bpScript = join(
      fx.target,
      "development_behavior_packs",
      fx.config.name,
      "scripts",
      "main.js",
    );
    const bpItem = join(
      fx.target,
      "development_behavior_packs",
      fx.config.name,
      "items",
      "example.item.json",
    );
    const bpManifest = join(
      fx.target,
      "development_behavior_packs",
      fx.config.name,
      "manifest.json",
    );
    const rpManifest = join(
      fx.target,
      "development_resource_packs",
      fx.config.name,
      "manifest.json",
    );
    const rpTex = join(
      fx.target,
      "development_resource_packs",
      fx.config.name,
      "textures",
      "example.png",
    );

    expect((await stat(bpScript)).isFile()).toBe(true);
    expect((await stat(bpItem)).isFile()).toBe(true);
    expect((await stat(bpManifest)).isFile()).toBe(true);
    expect((await stat(rpManifest)).isFile()).toBe(true);
    expect((await stat(rpTex)).isFile()).toBe(true);
  });

  it("re-deploying after a source edit produces updated content (clean slate)", async () => {
    await deploy(fx.config, { release: false, watch: false });

    // Modify a pack file in the fixture root.
    const srcItem = join(fx.root, "packs", "BP", "items", "example.item.json");
    const original = await readFile(srcItem, "utf8");
    const updated = original.replace(/}\s*$/, ',"_edited":true}');
    await writeFile(srcItem, updated);

    // Also drop a stale file into the target to verify clean-slate.
    const stalePath = join(
      fx.target,
      "development_behavior_packs",
      fx.config.name,
      "stale.txt",
    );
    await writeFile(stalePath, "stale");

    await deploy(fx.config, { release: false, watch: false });

    const deployedItem = join(
      fx.target,
      "development_behavior_packs",
      fx.config.name,
      "items",
      "example.item.json",
    );
    const deployedContent = await readFile(deployedItem, "utf8");
    expect(deployedContent).toContain('"_edited":true');

    let staleStillExists = true;
    try {
      await stat(stalePath);
    } catch {
      staleStillExists = false;
    }
    expect(staleStillExists).toBe(false);
  });

  it("throws DeployTargetError when target='custom' and customPath does not exist", async () => {
    const bad: BedrockConfig = {
      ...fx.config,
      deploy: {
        target: "custom",
        customPath: join(fx.target, "does-not-exist-subdir"),
      },
    };
    await expect(deploy(bad, { release: false, watch: false })).rejects.toBeInstanceOf(
      DeployTargetError,
    );
  });
});
