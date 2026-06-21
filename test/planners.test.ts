import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tree } from "../src/generate/core/tree.js";
import { planTree } from "../src/generate/core/plan.js";
import { GenerateError } from "../src/generate/core/errors.js";
import { planWeapon } from "../src/generate/weapon.js";
import { planTool } from "../src/generate/tool.js";
import { planArmor } from "../src/generate/armor.js";
import { planItem } from "../src/generate/item.js";
import { planEntity } from "../src/generate/entity.js";
import { planBlock } from "../src/generate/block.js";
import type { CreateOptions } from "../src/generate/core/types.js";
import { setupFixture } from "./helpers.js";

const NS = "test_addon"; // derived from fixture name "test-addon"

describe("pure planners", () => {
  let fx: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fx = await setupFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  /** Run a planner into a fresh tree and return staged paths + a JSON reader. */
  function run(
    planner: (t: Tree, c: typeof fx.config, o: CreateOptions) => unknown,
    opts: CreateOptions,
  ) {
    const tree = new Tree(fx.config.__configDir);
    planner(tree, fx.config, opts);
    const paths = tree.paths();
    const json = (rel: string) => JSON.parse(tree.read(rel)!) as Record<string, unknown>;
    const text = (rel: string) => tree.read(rel)!;
    return { tree, paths, json, text };
  }

  describe("weapon", () => {
    it("2D: emits item + registries, plain-string icon, namespaced atlas key, no geo/anim", () => {
      const { paths, json, text } = run(planWeapon, { name: "fire_sword", icon: "sword" });

      expect(paths).toEqual([
        "packs/BP/items/fire_sword.item.json",
        "packs/RP/texts/en_US.lang",
        "packs/RP/texts/languages.json",
        "packs/RP/textures/item_texture.json",
      ]);

      const item = json("packs/BP/items/fire_sword.item.json")["minecraft:item"] as any;
      expect(item.description.identifier).toBe(`${NS}:fire_sword`);
      expect(item.components["minecraft:icon"]).toBe(`${NS}_fire_sword`); // plain string, namespaced
      expect(typeof item.components["minecraft:icon"]).toBe("string");
      expect(item.components["minecraft:weapon"]).toBeUndefined(); // never emit
      expect(item.components["minecraft:damage"]).toBe(7);
      expect(item.components["minecraft:durability"].max_durability).toBe(1561);
      expect(item.components["minecraft:enchantable"]).toEqual({ slot: "sword", value: 10 });

      const tex = json("packs/RP/textures/item_texture.json").texture_data as any;
      expect(tex[`${NS}_fire_sword`]).toEqual({ textures: "textures/items/sword" });

      expect(text("packs/RP/texts/en_US.lang")).toContain(`item.${NS}:fire_sword=Fire Sword`);
      expect(json("packs/RP/texts/languages.json")).toEqual(["en_US"]);
    });

    it("3D: adds attachable + custom render controller, references user geometry, no geo/anim files", () => {
      const { paths, json } = run(planWeapon, { name: "fire_sword", mode: "3d" });

      expect(paths).toContain("packs/RP/attachables/fire_sword.attachable.json");
      expect(paths).toContain("packs/RP/render_controllers/fire_sword.rc.json");
      // No geometry/animation/texture files generated.
      expect(paths.some((p) => p.includes("models/"))).toBe(false);
      expect(paths.some((p) => p.includes("animations/"))).toBe(false);
      expect(paths.some((p) => p.endsWith(".geo.json"))).toBe(false);
      expect(paths.some((p) => p.endsWith(".animation.json"))).toBe(false);

      const attFile = json("packs/RP/attachables/fire_sword.attachable.json");
      expect(attFile.format_version).toBe("1.10.0");
      const att = attFile["minecraft:attachable"] as any;
      expect(att.description.identifier).toBe(`${NS}:fire_sword`); // == item id
      expect(att.description.geometry.default).toBe(`geometry.${NS}.fire_sword`);
      expect(att.description.render_controllers).toEqual([
        `controller.render.${NS}_fire_sword`,
      ]);

      const rc = json("packs/RP/render_controllers/fire_sword.rc.json") as any;
      expect(rc.format_version).toBe("1.10.0");
      expect(rc.render_controllers[`controller.render.${NS}_fire_sword`]).toBeDefined();
    });
  });

  describe("tool", () => {
    it("pickaxe (default): variant table tags, digger query, diamond tier", () => {
      const { paths, json } = run(planTool, { name: "ruby_pickaxe", icon: "ruby_pickaxe" });
      expect(paths).toContain("packs/BP/items/ruby_pickaxe.item.json");

      const c = (json("packs/BP/items/ruby_pickaxe.item.json")["minecraft:item"] as any)
        .components;
      expect(c["minecraft:icon"]).toBe(`${NS}_ruby_pickaxe`);
      expect(c["minecraft:enchantable"].slot).toBe("pickaxe");
      expect(c["minecraft:digger"].destroy_speeds[0].block.tags).toContain(
        "minecraft:is_pickaxe_item_destructible",
      );
      expect(c["minecraft:tags"].tags).toContain("minecraft:is_pickaxe");
      expect(c["minecraft:tags"].tags).toContain("minecraft:diamond_tier");
      expect(c["minecraft:damage"]).toBe(6);
    });

    it("axe variant swaps the tag/slot/query and default damage", () => {
      const { json } = run(planTool, { name: "ruby_axe", variant: "axe" });
      const c = (json("packs/BP/items/ruby_axe.item.json")["minecraft:item"] as any).components;
      expect(c["minecraft:enchantable"].slot).toBe("axe");
      expect(c["minecraft:tags"].tags).toContain("minecraft:is_axe");
      expect(c["minecraft:digger"].destroy_speeds[0].block.tags).toContain(
        "minecraft:is_axe_item_destructible",
      );
      expect(c["minecraft:damage"]).toBe(7);
    });

    it("rejects an unknown variant", () => {
      const tree = new Tree(fx.config.__configDir);
      expect(() => planTool(tree, fx.config, { name: "x", variant: "sword" })).toThrow(
        GenerateError,
      );
    });
  });

  describe("armor", () => {
    it("chestplate icon mode: enchant slot is armor_torso (NOT armor_chest)", () => {
      const { paths, json } = run(planArmor, { name: "ruby_chestplate", piece: "chestplate" });
      expect(paths).toEqual([
        "packs/BP/items/ruby_chestplate.item.json",
        "packs/RP/texts/en_US.lang",
        "packs/RP/texts/languages.json",
        "packs/RP/textures/item_texture.json",
      ]);

      const item = json("packs/BP/items/ruby_chestplate.item.json")["minecraft:item"] as any;
      expect(item.format_version === undefined).toBe(true); // version is at top level
      const c = item.components;
      expect(c["minecraft:enchantable"]).toEqual({ value: 9, slot: "armor_torso" });
      expect(c["minecraft:wearable"]).toEqual({ slot: "slot.armor.chest", protection: 6 });
      expect(c["minecraft:durability"].max_durability).toBe(340);
      expect(c["minecraft:icon"]).toBe(`${NS}_ruby_chestplate`);

      const top = json("packs/BP/items/ruby_chestplate.item.json");
      expect(top.format_version).toBe("1.20.80");
    });

    it("helmet uses armor_head + its own durability/protection", () => {
      const { json } = run(planArmor, { name: "ruby_helmet", piece: "helmet" });
      const c = (json("packs/BP/items/ruby_helmet.item.json")["minecraft:item"] as any)
        .components;
      expect(c["minecraft:enchantable"].slot).toBe("armor_head");
      expect(c["minecraft:wearable"].slot).toBe("slot.armor.head");
      expect(c["minecraft:durability"].max_durability).toBe(265);
    });

    it("3d mode adds an attachable + render controller, no geo/texture files", () => {
      const { paths, json } = run(planArmor, {
        name: "ruby_chestplate",
        piece: "chestplate",
        mode: "3d",
      });
      expect(paths).toContain("packs/RP/attachables/ruby_chestplate.attachable.json");
      expect(paths).toContain("packs/RP/render_controllers/ruby_chestplate.rc.json");
      expect(paths.some((p) => p.includes("models/"))).toBe(false);

      const att = json("packs/RP/attachables/ruby_chestplate.attachable.json")[
        "minecraft:attachable"
      ] as any;
      expect(att.description.materials).toEqual({
        default: "armor",
        enchanted: "armor_enchanted",
      });
      expect(att.description.render_controllers).toEqual([
        `controller.render.${NS}_ruby_chestplate`,
      ]);
    });
  });

  describe("item", () => {
    it("generic item: 64 stack, items category, plain-string icon", () => {
      const { paths, json, text } = run(planItem, { name: "ruby", icon: "ruby" });
      expect(paths).toEqual([
        "packs/BP/items/ruby.item.json",
        "packs/RP/texts/en_US.lang",
        "packs/RP/texts/languages.json",
        "packs/RP/textures/item_texture.json",
      ]);

      const top = json("packs/BP/items/ruby.item.json");
      expect(top.format_version).toBe("1.21.80");
      const item = top["minecraft:item"] as any;
      expect(item.description.menu_category.category).toBe("items");
      expect(item.components["minecraft:icon"]).toBe(`${NS}_ruby`);
      expect(item.components["minecraft:max_stack_size"]).toBe(64);

      const tex = json("packs/RP/textures/item_texture.json").texture_data as any;
      expect(tex[`${NS}_ruby`]).toEqual({ textures: "textures/items/ruby" });
      expect(text("packs/RP/texts/en_US.lang")).toContain(`item.${NS}:ruby=Ruby`);
    });

    it("rejects a non-snake_case name", () => {
      const tree = new Tree(fx.config.__configDir);
      expect(() => planItem(tree, fx.config, { name: "Fire Sword" })).toThrow(GenerateError);
      expect(() => planItem(tree, fx.config, { name: "ruby2" })).toThrow(GenerateError);
    });
  });

  describe("entity", () => {
    it("3D: emits BP (entities, plural) + RP client_entity (entity, singular), no geo files", () => {
      const { paths, json, text } = run(planEntity, { name: "goblin", mode: "3d" });
      expect(paths).toContain("packs/BP/entities/goblin.json");
      expect(paths).toContain("packs/RP/entity/goblin.json");
      expect(paths.some((p) => p.includes("models/"))).toBe(false);
      expect(paths.some((p) => p.endsWith(".geo.json"))).toBe(false);

      const bp = json("packs/BP/entities/goblin.json");
      expect(bp.format_version).toBe("1.21.40");
      const bpDesc = (bp["minecraft:entity"] as any).description;
      expect(bpDesc.identifier).toBe(`${NS}:goblin`);
      expect(bpDesc.is_summonable).toBe(true);

      const rp = json("packs/RP/entity/goblin.json");
      expect(rp.format_version).toBe("1.10.0"); // pinned old, do not sync
      const rpDesc = (rp["minecraft:client_entity"] as any).description;
      expect(rpDesc.identifier).toBe(`${NS}:goblin`);
      expect(rpDesc.geometry.default).toBe(`geometry.${NS}.goblin`);
      expect(rpDesc.spawn_egg).toEqual({ base_color: "#000000", overlay_color: "#ffffff" });

      expect(text("packs/RP/texts/en_US.lang")).toContain(`entity.${NS}:goblin.name=Goblin`);
      expect(text("packs/RP/texts/en_US.lang")).toContain(
        `item.spawn_egg.entity.${NS}:goblin.name=Spawn Goblin`,
      );
    });

    it("2D: billboard sprite material/geometry/render controller", () => {
      const { json } = run(planEntity, { name: "wisp", mode: "2d" });
      const rpDesc = (json("packs/RP/entity/wisp.json")["minecraft:client_entity"] as any)
        .description;
      expect(rpDesc.materials).toEqual({ default: "snowball" });
      expect(rpDesc.geometry.default).toBe("geometry.item_sprite");
      expect(rpDesc.render_controllers).toEqual(["controller.render.item_sprite"]);
      expect(rpDesc.scripts.animate).toEqual(["flying"]);
    });
  });

  describe("block", () => {
    it("emits all four artifacts; block has BOTH geometry + material_instances", () => {
      const { paths, json, text } = run(planBlock, { name: "ruby_block" });
      expect(paths).toEqual([
        "packs/BP/blocks/ruby_block.block.json",
        "packs/RP/blocks.json",
        "packs/RP/texts/en_US.lang",
        "packs/RP/texts/languages.json",
        "packs/RP/textures/terrain_texture.json",
      ]);

      const top = json("packs/BP/blocks/ruby_block.block.json");
      expect(top.format_version).toBe("1.21.50");
      const c = (top["minecraft:block"] as any).components;
      expect(c["minecraft:geometry"]).toBe("minecraft:geometry.full_block"); // pairing rule
      expect(c["minecraft:material_instances"]["*"].texture).toBe(`${NS}_ruby_block`); // key, not path
      expect(c["minecraft:material_instances"]["*"].render_method).toBe("opaque");

      const terrain = json("packs/RP/textures/terrain_texture.json").texture_data as any;
      expect(terrain[`${NS}_ruby_block`]).toEqual({ textures: "textures/blocks/ruby_block" });

      const blocks = json("packs/RP/blocks.json") as any;
      expect(blocks[`${NS}:ruby_block`]).toEqual({
        textures: `${NS}_ruby_block`,
        sound: "stone",
      });
      expect(blocks.format_version).toBe("1.10.0");

      expect(text("packs/RP/texts/en_US.lang")).toContain(`tile.${NS}:ruby_block.name=Ruby Block`);
    });

    it("light emission flag adds minecraft:light_emission", () => {
      const { json } = run(planBlock, { name: "glow_block", light: 12 });
      const c = (json("packs/BP/blocks/glow_block.block.json")["minecraft:block"] as any)
        .components;
      expect(c["minecraft:light_emission"]).toBe(12);
    });

    it("rejects an unknown render method", () => {
      const tree = new Tree(fx.config.__configDir);
      expect(() => planBlock(tree, fx.config, { name: "x", renderMethod: "fancy" })).toThrow(
        GenerateError,
      );
    });
  });

  describe("plan classification", () => {
    it("re-running a planner against flushed output classifies everything as skip", async () => {
      // First run + flush.
      const t1 = new Tree(fx.config.__configDir);
      planBlock(t1, fx.config, { name: "ruby_block" });
      await t1.flush();

      // Second run produces byte-identical content → all skip, no conflict.
      const t2 = new Tree(fx.config.__configDir);
      planBlock(t2, fx.config, { name: "ruby_block" });
      const plan = planTree(t2, false);
      expect(plan.every((f) => f.status === "skip")).toBe(true);
    });
  });
});
