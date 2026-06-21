import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/cli.js";

describe("parseArgs — create command", () => {
  it("captures `create weapon fire_sword --icon sword`", () => {
    const a = parseArgs(["create", "weapon", "fire_sword", "--icon", "sword"]);
    expect(a.command).toBe("create");
    expect(a.type).toBe("weapon");
    expect(a.genName).toBe("fire_sword");
    expect(a.icon).toBe("sword");
    expect(a.unknown).toEqual([]);
    expect(a.extraPositionals).toEqual([]);
  });

  it("captures `create weapon fire_sword --mode 3d`", () => {
    const a = parseArgs(["create", "weapon", "fire_sword", "--mode", "3d"]);
    expect(a.type).toBe("weapon");
    expect(a.genName).toBe("fire_sword");
    expect(a.mode).toBe("3d");
  });

  it("accepts the type with no name (interactive will prompt)", () => {
    const a = parseArgs(["create", "block"]);
    expect(a.command).toBe("create");
    expect(a.type).toBe("block");
    expect(a.genName).toBeUndefined();
    expect(a.extraPositionals).toEqual([]);
  });

  it("parses boolean generator flags", () => {
    const a = parseArgs(["create", "item", "ruby", "--force", "--dry-run", "-y"]);
    expect(a.force).toBe(true);
    expect(a.dryRun).toBe(true);
    expect(a.yes).toBe(true);
    expect(a.unknown).toEqual([]);
  });

  it("supports --name as an alias/override", () => {
    const a = parseArgs(["create", "item", "--name", "ruby"]);
    expect(a.type).toBe("item");
    expect(a.genName).toBeUndefined();
    expect(a.name).toBe("ruby");
  });

  it("rejects a THIRD positional after create <type> <name>", () => {
    const a = parseArgs(["create", "weapon", "fire_sword", "extra"]);
    expect(a.type).toBe("weapon");
    expect(a.genName).toBe("fire_sword");
    expect(a.extraPositionals).toEqual(["extra"]);
  });

  it("parses numeric flags as strings (converted at dispatch)", () => {
    const a = parseArgs(["create", "weapon", "fire_sword", "--damage", "9", "--durability", "2000"]);
    expect(a.damage).toBe("9");
    expect(a.durability).toBe("2000");
  });

  it("supports --flag=value form for generator flags", () => {
    const a = parseArgs(["create", "tool", "ruby_pickaxe", "--variant=pickaxe", "--tier=iron"]);
    expect(a.variant).toBe("pickaxe");
    expect(a.tier).toBe("iron");
  });
});

describe("parseArgs — generator-flag scoping", () => {
  it("rejects a generator value-flag on a non-create command", () => {
    const a = parseArgs(["build", "--piece", "chestplate"]);
    expect(a.command).toBe("build");
    // The flag is pushed to `unknown` so it errors rather than being swallowed.
    expect(a.unknown).toContain("--piece");
  });

  it("rejects a generator boolean-flag on a non-create command", () => {
    const a = parseArgs(["build", "--dry-run"]);
    expect(a.command).toBe("build");
    expect(a.unknown).toContain("--dry-run");
  });

  it("rejects --force on deploy (would otherwise mask a typo)", () => {
    const a = parseArgs(["deploy", "--force"]);
    expect(a.unknown).toContain("--force");
  });

  it("still parses shared flags normally on non-create commands", () => {
    const a = parseArgs(["deploy", "--watch", "--release"]);
    expect(a.command).toBe("deploy");
    expect(a.watch).toBe(true);
    expect(a.release).toBe(true);
    expect(a.unknown).toEqual([]);
  });

  it("does not let other commands swallow `--piece` value as a positional", () => {
    const a = parseArgs(["build", "--piece", "chestplate"]);
    // `chestplate` is consumed as the flag's value, not an extra positional.
    expect(a.extraPositionals).toEqual([]);
    expect(a.unknown).toContain("--piece");
  });
});
