import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { build } from "../src/commands/build.js";
import { setupFixture } from "./helpers.js";

describe("build command", () => {
  let fixture: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fixture = await setupFixture();
  });
  afterEach(async () => {
    await fixture.cleanup();
  });

  it("produces a complete dist/ tree (bundle + copied pack files)", async () => {
    await build(fixture.config, { release: false, clean: false });

    const mainJs = join(
      fixture.root,
      "dist",
      "packs",
      "BP",
      "scripts",
      "main.js",
    );
    const bpItem = join(
      fixture.root,
      "dist",
      "packs",
      "BP",
      "items",
      "example.item.json",
    );
    const rpTex = join(
      fixture.root,
      "dist",
      "packs",
      "RP",
      "textures",
      "example.png",
    );

    expect((await stat(mainJs)).isFile()).toBe(true);
    expect((await stat(bpItem)).isFile()).toBe(true);
    expect((await stat(rpTex)).isFile()).toBe(true);
  });

  it("--clean removes prior dist contents before rebuild", async () => {
    // Seed `dist/` with a stale file that should NOT survive a --clean build.
    const stalePath = join(fixture.root, "dist", "stale.txt");
    await mkdir(join(fixture.root, "dist"), { recursive: true });
    await writeFile(stalePath, "stale");

    await build(fixture.config, { release: false, clean: true });

    let staleExists = true;
    try {
      await stat(stalePath);
    } catch {
      staleExists = false;
    }
    expect(staleExists).toBe(false);

    // Sanity check: the real outputs are still there.
    const mainJs = join(
      fixture.root,
      "dist",
      "packs",
      "BP",
      "scripts",
      "main.js",
    );
    expect((await stat(mainJs)).isFile()).toBe(true);
  });
});
