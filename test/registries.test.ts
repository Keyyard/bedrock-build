import { describe, expect, it } from "vitest";

import { Tree } from "../src/generate/core/tree.js";
import {
  ensureLanguages,
  mergeBlocks,
  mergeItemTexture,
  mergeLang,
  mergeTerrainTexture,
} from "../src/generate/core/registries.js";

const ROOT = "C:/nonexistent-root"; // no disk reads occur; merges seed in memory

function freshTree(): Tree {
  return new Tree(ROOT);
}

describe("registry merges (idempotent, key-based)", () => {
  it("item_texture: seeds vanilla skeleton when absent, upserts the key", () => {
    const t = freshTree();
    mergeItemTexture(t, "RP", "ns_ruby", "textures/items/ruby");
    const file = JSON.parse(t.read("RP/textures/item_texture.json")!);
    expect(file.resource_pack_name).toBe("vanilla");
    expect(file.texture_name).toBe("atlas.items");
    expect(file.texture_data.ns_ruby).toEqual({ textures: "textures/items/ruby" });
  });

  it("item_texture: re-adding the same key+path is a no-op (byte-identical)", () => {
    const t = freshTree();
    mergeItemTexture(t, "RP", "ns_ruby", "textures/items/ruby");
    const first = t.read("RP/textures/item_texture.json")!;
    mergeItemTexture(t, "RP", "ns_ruby", "textures/items/ruby");
    const second = t.read("RP/textures/item_texture.json")!;
    expect(second).toBe(first);
  });

  it("item_texture: adding a second key keeps both, sorted", () => {
    const t = freshTree();
    mergeItemTexture(t, "RP", "ns_zinc", "textures/items/zinc");
    mergeItemTexture(t, "RP", "ns_alpha", "textures/items/alpha");
    const file = JSON.parse(t.read("RP/textures/item_texture.json")!);
    expect(Object.keys(file.texture_data)).toEqual(["ns_alpha", "ns_zinc"]); // sorted
  });

  it("terrain_texture: seeds skeleton with num_mip_levels 0, padding 8", () => {
    const t = freshTree();
    mergeTerrainTexture(t, "RP", "ns_block", "textures/blocks/block");
    const file = JSON.parse(t.read("RP/textures/terrain_texture.json")!);
    expect(file.resource_pack_name).toBe("vanilla");
    expect(file.texture_name).toBe("atlas.terrain");
    expect(file.padding).toBe(8);
    expect(file.num_mip_levels).toBe(0);
    expect(file.texture_data.ns_block).toEqual({ textures: "textures/blocks/block" });
  });

  it("blocks.json: seeds format_version, upserts the id entry, idempotent", () => {
    const t = freshTree();
    mergeBlocks(t, "RP", "ns:block", "ns_block", "stone");
    const first = t.read("RP/blocks.json")!;
    const file = JSON.parse(first);
    expect(file.format_version).toBe("1.10.0");
    expect(file["ns:block"]).toEqual({ textures: "ns_block", sound: "stone" });

    mergeBlocks(t, "RP", "ns:block", "ns_block", "stone");
    expect(t.read("RP/blocks.json")!).toBe(first); // no change
  });

  it("en_US.lang: upserts without duplicating, preserves comments", () => {
    const t = freshTree();
    t.write("RP/texts/en_US.lang", "# header comment\nitem.ns:old=Old\n");
    mergeLang(t, "RP", "item.ns:ruby", "Ruby");
    let lang = t.read("RP/texts/en_US.lang")!;
    expect(lang).toContain("# header comment");
    expect(lang).toContain("item.ns:old=Old");
    expect(lang).toContain("item.ns:ruby=Ruby");

    // Re-add same key with a new value → replaced, not duplicated.
    mergeLang(t, "RP", "item.ns:ruby", "Ruby Gem");
    lang = t.read("RP/texts/en_US.lang")!;
    const occurrences = lang.split("\n").filter((l) => l.startsWith("item.ns:ruby="));
    expect(occurrences).toEqual(["item.ns:ruby=Ruby Gem"]);
  });

  it("en_US.lang: re-adding the same key+value is a no-op", () => {
    const t = freshTree();
    mergeLang(t, "RP", "item.ns:ruby", "Ruby");
    const first = t.read("RP/texts/en_US.lang")!;
    mergeLang(t, "RP", "item.ns:ruby", "Ruby");
    expect(t.read("RP/texts/en_US.lang")!).toBe(first);
  });

  it("languages.json: creates ['en_US'] when absent, idempotent thereafter", () => {
    const t = freshTree();
    ensureLanguages(t, "RP");
    expect(JSON.parse(t.read("RP/texts/languages.json")!)).toEqual(["en_US"]);
    const first = t.read("RP/texts/languages.json")!;
    ensureLanguages(t, "RP");
    expect(t.read("RP/texts/languages.json")!).toBe(first);
  });

  it("languages.json: keeps existing languages and adds en_US once", () => {
    const t = freshTree();
    t.write("RP/texts/languages.json", JSON.stringify(["fr_FR"]));
    ensureLanguages(t, "RP");
    expect(JSON.parse(t.read("RP/texts/languages.json")!)).toEqual(["fr_FR", "en_US"]);
  });
});
