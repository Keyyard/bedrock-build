import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tree } from "../src/generate/core/tree.js";
import { hasConflict, planTree } from "../src/generate/core/plan.js";
import { planBlock } from "../src/generate/block.js";
import { planItem } from "../src/generate/item.js";
import { setupFixture } from "./helpers.js";

/**
 * Regression: the 3.0 starter SHIPS seeded (non-empty) registry/lang files.
 * Adding the first key into them legitimately changes their bytes, which must
 * classify as `update`, NOT `conflict`. Before the fix every generator aborted
 * with "nothing was written" on a clean first run against the real starter.
 */
describe("seeded-registry merge (no false conflict)", () => {
  let fx: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fx = await setupFixture();
    const rp = join(fx.root, "packs", "RP");
    const seed = async (rel: string, content: string) => {
      const abs = join(rp, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    };
    await seed(
      "textures/item_texture.json",
      JSON.stringify({ resource_pack_name: "vanilla", texture_name: "atlas.items", texture_data: {} }, null, 2) + "\n",
    );
    await seed(
      "textures/terrain_texture.json",
      JSON.stringify({ resource_pack_name: "vanilla", texture_name: "atlas.terrain", padding: 8, num_mip_levels: 0, texture_data: {} }, null, 2) + "\n",
    );
    await seed("blocks.json", JSON.stringify({ format_version: "1.10.0" }, null, 2) + "\n");
    await seed("texts/en_US.lang", "pack.name=Test\npack.description=Test\n");
    await seed("texts/languages.json", JSON.stringify(["en_US"]) + "\n");
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("block generator merges into seeded registries without conflict", () => {
    const tree = new Tree(fx.config.__configDir);
    planBlock(tree, fx.config, { name: "ruby_block", texture: "ruby_block" });
    const plan = planTree(tree, false);

    expect(hasConflict(plan)).toBe(false);

    const status = (rel: string) => plan.find((f) => f.relPath === rel)?.status;
    expect(status("packs/BP/blocks/ruby_block.block.json")).toBe("create");
    expect(status("packs/RP/textures/terrain_texture.json")).toBe("update");
    expect(status("packs/RP/blocks.json")).toBe("update");
    expect(status("packs/RP/texts/en_US.lang")).toBe("update");

    // The merged registry keeps the seed AND adds the new namespaced key.
    const terrain = JSON.parse(tree.read("packs/RP/textures/terrain_texture.json")!) as {
      resource_pack_name: string;
      texture_data: Record<string, unknown>;
    };
    expect(terrain.resource_pack_name).toBe("vanilla");
    expect(Object.keys(terrain.texture_data)).toContain(`${fx.config.namespace}_ruby_block`);
  });

  it("item generator merges into a seeded item_texture without conflict", () => {
    const tree = new Tree(fx.config.__configDir);
    planItem(tree, fx.config, { name: "ruby", icon: "ruby" });
    const plan = planTree(tree, false);

    expect(hasConflict(plan)).toBe(false);
    expect(plan.find((f) => f.relPath === "packs/RP/textures/item_texture.json")?.status).toBe("update");
    expect(plan.find((f) => f.relPath === "packs/BP/items/ruby.item.json")?.status).toBe("create");
  });
});
