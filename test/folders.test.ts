import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BP_FOLDERS,
  RP_FOLDERS,
  createFolders,
  listFolderOptions,
} from "../src/commands/folders.js";
import { setupFixture } from "./helpers.js";

describe("folders command", () => {
  let fx: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fx = await setupFixture();
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  describe("canonical lists", () => {
    it("BP_FOLDERS uses plural 'entities' (server-side convention)", () => {
      const subpaths = BP_FOLDERS.map((f) => f.subpath);
      expect(subpaths).toContain("entities");
      expect(subpaths).not.toContain("entity");
    });

    it("RP_FOLDERS uses singular 'entity' (client-side convention)", () => {
      const subpaths = RP_FOLDERS.map((f) => f.subpath);
      expect(subpaths).toContain("entity");
      expect(subpaths).not.toContain("entities");
    });

    it("RP textures + models use singular 'entity' subdir", () => {
      const subpaths = RP_FOLDERS.map((f) => f.subpath);
      expect(subpaths).toContain("textures/entity");
      expect(subpaths).toContain("models/entity");
    });

    it("BP_FOLDERS does NOT include 'scripts' (reserved for the bundler)", () => {
      const subpaths = BP_FOLDERS.map((f) => f.subpath);
      expect(subpaths).not.toContain("scripts");
    });

    it("every entry has a non-empty hint", () => {
      for (const def of [...BP_FOLDERS, ...RP_FOLDERS]) {
        expect(def.hint.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("listFolderOptions", () => {
    it("returns absolute paths anchored at the configured pack roots", async () => {
      const { bp, rp } = await listFolderOptions(fx.config);
      expect(bp.length).toBe(BP_FOLDERS.length);
      expect(rp.length).toBe(RP_FOLDERS.length);
      const entitiesOpt = bp.find((o) => o.value.endsWith(join("BP", "entities")));
      expect(entitiesOpt).toBeDefined();
      const entityOpt = rp.find((o) => o.value.endsWith(join("RP", "entity")));
      expect(entityOpt).toBeDefined();
    });

    it("marks already-existing folders with the existing flag", async () => {
      const itemsDir = join(fx.config.packs.bp, "items");
      await mkdir(itemsDir, { recursive: true });

      const { bp } = await listFolderOptions(fx.config);
      const itemsOpt = bp.find((o) => o.value === itemsDir);
      expect(itemsOpt?.existing).toBe(true);
      expect(itemsOpt?.label).toContain("(exists)");

      const blocksOpt = bp.find((o) => o.value === join(fx.config.packs.bp, "blocks"));
      expect(blocksOpt?.existing).toBe(false);
      expect(blocksOpt?.label).not.toContain("(exists)");
    });
  });

  describe("createFolders", () => {
    it("creates the requested directories and reports counts", async () => {
      const target = join(fx.config.packs.bp, "blocks");
      const nested = join(fx.config.packs.rp, "models", "entity");

      const result = await createFolders([target, nested]);
      expect(result.created).toBe(2);
      expect(result.alreadyExisted).toBe(0);

      expect((await stat(target)).isDirectory()).toBe(true);
      expect((await stat(nested)).isDirectory()).toBe(true);
    });

    it("skips existing directories without erroring", async () => {
      const existing = join(fx.config.packs.bp, "loot_tables");
      await mkdir(existing, { recursive: true });
      const fresh = join(fx.config.packs.rp, "particles");

      const result = await createFolders([existing, fresh]);
      expect(result.created).toBe(1);
      expect(result.alreadyExisted).toBe(1);

      expect((await stat(fresh)).isDirectory()).toBe(true);
    });

    it("handles empty input as a no-op", async () => {
      const result = await createFolders([]);
      expect(result).toEqual({ created: 0, alreadyExisted: 0 });
    });
  });
});
