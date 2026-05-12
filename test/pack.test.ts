import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pack } from "../src/commands/pack.js";
import { setupFixture } from "./helpers.js";

describe("pack command", () => {
  let fixture: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fixture = await setupFixture();
  });
  afterEach(async () => {
    await fixture.cleanup();
  });

  it("produces a .mcaddon zip containing <name>_BP/ and <name>_RP/", async () => {
    await pack(fixture.config, {});

    const outputPath = join(
      fixture.root,
      "dist",
      "test-addon-1.0.0.mcaddon",
    );

    // File exists and is non-empty.
    const st = await stat(outputPath);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(0);

    // Smoke-check the zip by scanning the bytes for entry filenames. Zip
    // central-directory filename headers store names as UTF-8 plain text, so
    // a buffer search is sufficient for an existence check.
    const buf = await readFile(outputPath);
    const text = buf.toString("binary");
    expect(text).toContain("test-addon_BP/");
    expect(text).toContain("test-addon_RP/");
    expect(text).toContain("manifest.json");
    expect(text).toContain("scripts/main.js");
  });

  it("respects --output override", async () => {
    const customOutput = join(fixture.root, "custom-name.mcaddon");
    await pack(fixture.config, { output: customOutput });

    const st = await stat(customOutput);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(0);
  });
});
