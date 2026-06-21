import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { deriveNamespace } from "../src/generate/core/identifier.js";
import { setupFixture } from "./helpers.js";

async function writeJson(root: string, file: string, obj: unknown): Promise<void> {
  await writeFile(join(root, file), JSON.stringify(obj, null, 2), "utf8");
}

function standardConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "minecraftBedrock",
    name: "My Cool Add-On!",
    targetVersion: "1.21.0",
    packs: { behaviorPack: "packs/BP", resourcePack: "packs/RP" },
    "bedrock-cli": {
      version: "2.3.4",
      entry: "src/main.ts",
      out: "dist",
      deploy: { target: "custom", customPath: "." },
      ...extra,
    },
  };
}

describe("deriveNamespace (pure)", () => {
  it("lowercases and snake-cases an arbitrary name", () => {
    expect(deriveNamespace("My Cool Add-On!")).toBe("my_cool_add_on");
  });

  it("trims leading/trailing underscores", () => {
    expect(deriveNamespace("  spaced  ")).toBe("spaced");
  });

  it("prefixes a leading digit", () => {
    expect(deriveNamespace("3dpack")).toBe("ns_3dpack");
  });

  it("never returns empty", () => {
    expect(deriveNamespace("!!!")).toBe("ns");
  });

  it("preserves a clean snake_case name", () => {
    expect(deriveNamespace("my_addon")).toBe("my_addon");
  });
});

describe("config namespace resolution", () => {
  let fixture: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fixture = await setupFixture();
  });
  afterEach(async () => {
    await fixture.cleanup();
  });

  it("derives from the name when no namespace key is present", async () => {
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", standardConfig());
    const c = await loadConfig(path);
    expect(c.namespace).toBe("my_cool_add_on");
  });

  it("uses a valid explicit namespace", async () => {
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", standardConfig({ namespace: "my_addon" }));
    const c = await loadConfig(path);
    expect(c.namespace).toBe("my_addon");
  });

  it("is NON-FATAL on a malformed namespace: derives instead of throwing", async () => {
    const path = join(fixture.root, "config.json");
    // Uppercase + spaces + colon — all invalid for a namespace.
    await writeJson(fixture.root, "config.json", standardConfig({ namespace: "Bad NS:1" }));
    const c = await loadConfig(path); // must not throw
    expect(c.namespace).toBe("my_cool_add_on");
  });

  it("is NON-FATAL on a reserved namespace: derives instead of throwing", async () => {
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", standardConfig({ namespace: "minecraft" }));
    const c = await loadConfig(path); // must not throw
    expect(c.namespace).toBe("my_cool_add_on");
  });

  it("legacy bedrock.config.json (no namespace) derives from name", async () => {
    // The fixture's legacy config has name "test-addon".
    expect(fixture.config.namespace).toBe("test_addon");
  });
});
