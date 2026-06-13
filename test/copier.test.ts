import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { copyPackFiles, syncTree } from "../src/copier.js";
import { setupFixture } from "./helpers.js";

describe("copyPackFiles", () => {
  let fixture: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fixture = await setupFixture();
  });
  afterEach(async () => {
    await fixture.cleanup();
  });

  it("copies BP items and RP textures into dist/packs/", async () => {
    await copyPackFiles(fixture.config);

    const bpManifest = join(fixture.root, "dist", "packs", "BP", "manifest.json");
    const bpItem = join(
      fixture.root,
      "dist",
      "packs",
      "BP",
      "items",
      "example.item.json",
    );
    const rpManifest = join(fixture.root, "dist", "packs", "RP", "manifest.json");
    const rpTex = join(
      fixture.root,
      "dist",
      "packs",
      "RP",
      "textures",
      "example.png",
    );

    expect((await stat(bpManifest)).isFile()).toBe(true);
    expect((await stat(bpItem)).isFile()).toBe(true);
    expect((await stat(rpManifest)).isFile()).toBe(true);
    expect((await stat(rpTex)).isFile()).toBe(true);
  });
});

describe("syncTree (incremental deploy)", () => {
  let src: string;
  let dst: string;

  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), "synctree-src-"));
    dst = await mkdtemp(join(tmpdir(), "synctree-dst-"));
  });
  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(dst, { recursive: true, force: true });
  });

  it("copies new/changed files, prunes stale ones, and skips unchanged", async () => {
    await mkdir(join(src, "sub"), { recursive: true });
    await writeFile(join(src, "keep.txt"), "keep");
    await writeFile(join(src, "change.txt"), "v1");
    await writeFile(join(src, "sub", "gone.txt"), "gone");

    await syncTree(src, dst);
    expect(await readFile(join(dst, "keep.txt"), "utf8")).toBe("keep");
    expect(await readFile(join(dst, "change.txt"), "utf8")).toBe("v1");
    expect(await readFile(join(dst, "sub", "gone.txt"), "utf8")).toBe("gone");

    const keepMtime = (await stat(join(dst, "keep.txt"))).mtimeMs;

    // Mutate the source: change one file, add one, remove one. Also drop a
    // stale file straight into dst that the source never had.
    await writeFile(join(src, "change.txt"), "v2-longer");
    await writeFile(join(src, "added.txt"), "new");
    await rm(join(src, "sub", "gone.txt"), { force: true });
    await writeFile(join(dst, "stale.txt"), "stale");

    await syncTree(src, dst);

    expect(await readFile(join(dst, "change.txt"), "utf8")).toBe("v2-longer");
    expect(await readFile(join(dst, "added.txt"), "utf8")).toBe("new");
    await expect(stat(join(dst, "sub", "gone.txt"))).rejects.toBeTruthy();
    await expect(stat(join(dst, "stale.txt"))).rejects.toBeTruthy();
    // Unchanged file is not recopied, so its mtime is preserved.
    expect((await stat(join(dst, "keep.txt"))).mtimeMs).toBe(keepMtime);
  });
});
