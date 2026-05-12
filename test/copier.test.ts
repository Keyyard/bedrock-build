import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { copyPackFiles } from "../src/copier.js";
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
