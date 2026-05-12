import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildBundle } from "../src/bundler.js";
import { setupFixture } from "./helpers.js";

describe("buildBundle", () => {
  let fixture: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fixture = await setupFixture();
  });
  afterEach(async () => {
    await fixture.cleanup();
  });

  it("emits dist/packs/BP/scripts/main.js in dev mode with inline sourcemap", async () => {
    const result = await buildBundle(fixture.config, { release: false });

    const expectedOut = join(
      fixture.root,
      "dist",
      "packs",
      "BP",
      "scripts",
      "main.js",
    );
    expect(result.outputPath).toBe(expectedOut);

    const st = await stat(expectedOut);
    expect(st.isFile()).toBe(true);

    const content = await readFile(expectedOut, "utf8");
    expect(content).toContain("sourceMappingURL=data:application/json;base64,");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("omits sourcemaps in release mode", async () => {
    const result = await buildBundle(fixture.config, { release: true });

    const content = await readFile(result.outputPath, "utf8");
    expect(content).not.toContain("sourceMappingURL=");
  });
});
