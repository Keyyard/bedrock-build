import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config.js";
import { setupFixture } from "./helpers.js";

/** Write a JSON object to `<root>/<file>`. */
async function writeJson(root: string, file: string, obj: unknown): Promise<void> {
  await writeFile(join(root, file), JSON.stringify(obj, null, 2), "utf8");
}

/** A standard Bedrock-OSS shape pointing at the fixture's real packs. */
function standardConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "minecraftBedrock",
    name: "standard-addon",
    authors: ["keyyard"],
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

describe("loadConfig", () => {
  let fixture: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fixture = await setupFixture();
  });
  afterEach(async () => {
    await fixture.cleanup();
  });

  it("loads the legacy bedrock.config.json shape", async () => {
    // setupFixture already loaded the legacy config; assert its normalization.
    const c = fixture.config;
    expect(c.name).toBe("test-addon");
    expect(c.version).toBe("1.0.0");
    expect(c.packs.bp.endsWith(join("packs", "BP"))).toBe(true);
    expect(c.packs.rp.endsWith(join("packs", "RP"))).toBe(true);
    expect(c.entry.endsWith(join("src", "main.ts"))).toBe(true);
    expect(c.deploy.target).toBe("custom");
  });

  it("loads the standard Bedrock-OSS shape with a bedrock-cli namespace", async () => {
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", standardConfig());

    const c = await loadConfig(path);
    expect(c.name).toBe("standard-addon");
    expect(c.version).toBe("2.3.4");
    expect(c.packs.bp.endsWith(join("packs", "BP"))).toBe(true);
    expect(c.packs.rp.endsWith(join("packs", "RP"))).toBe(true);
    expect(c.entry.endsWith(join("src", "main.ts"))).toBe(true);
    expect(c.deploy.target).toBe("custom");
    // targetVersion maps onto the serverVersion hint.
    expect(c.minecraft?.serverVersion).toBe("1.21.0");
  });

  it("supports a .js entry", async () => {
    await writeFile(join(fixture.root, "src", "main.js"), "console.log('hi');", "utf8");
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", standardConfig({ entry: "src/main.js" }));

    const c = await loadConfig(path);
    expect(c.entry.endsWith(join("src", "main.js"))).toBe(true);
  });

  it("defaults the entry to src/main.js when main.ts is absent", async () => {
    await rm(join(fixture.root, "src", "main.ts"), { force: true });
    await writeFile(join(fixture.root, "src", "main.js"), "console.log('hi');", "utf8");

    const cfg = standardConfig();
    delete (cfg["bedrock-cli"] as Record<string, unknown>).entry;
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", cfg);

    const c = await loadConfig(path);
    expect(c.entry.endsWith(join("src", "main.js"))).toBe(true);
  });

  it("sources version from package.json when the config omits it", async () => {
    await writeJson(fixture.root, "package.json", { name: "x", version: "9.8.7" });

    const cfg = standardConfig();
    delete (cfg["bedrock-cli"] as Record<string, unknown>).version;
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", cfg);

    const c = await loadConfig(path);
    expect(c.version).toBe("9.8.7");
  });

  it("prefers config.json over bedrock.config.json when both exist", async () => {
    // The fixture already has a legacy bedrock.config.json (name: test-addon).
    await writeJson(fixture.root, "config.json", standardConfig());

    const prevCwd = process.cwd();
    try {
      process.chdir(fixture.root);
      const c = await loadConfig(); // no explicit path -> probe
      expect(c.name).toBe("standard-addon");
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("rejects an invalid semver version with exit code 2", async () => {
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", standardConfig({ version: "not-semver" }));

    await expect(loadConfig(path)).rejects.toMatchObject({
      name: "ConfigError",
      exitCode: 2,
    });
  });

  it("rejects a config missing name with exit code 2", async () => {
    const cfg = standardConfig();
    delete cfg.name;
    const path = join(fixture.root, "config.json");
    await writeJson(fixture.root, "config.json", cfg);

    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });
});
