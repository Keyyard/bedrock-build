import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { watch } from "../src/commands/watch.js";
import { setupFixture } from "./helpers.js";

/** Poll `fs.stat` on `path` until `predicate(content)` is true or `timeoutMs` elapses. */
async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

describe("watch command (smoke)", () => {
  let fixture: Awaited<ReturnType<typeof setupFixture>>;
  let watchPromise: Promise<void> | null = null;

  beforeEach(async () => {
    fixture = await setupFixture();
    watchPromise = null;
  });
  afterEach(async () => {
    // Trigger shutdown by raising SIGINT — the watch loop listens for it.
    if (watchPromise) {
      process.emit("SIGINT");
      // Wait for the watch promise to settle so cleanup is deterministic.
      try {
        await Promise.race([
          watchPromise,
          new Promise<void>((r) => setTimeout(r, 5000)),
        ]);
      } catch {
        // ignore
      }
    }
    await fixture.cleanup();
  });

  it("initial build then mirrors a pack file change into dist/", async () => {
    // Start watch in the background.
    watchPromise = watch(fixture.config, {});

    // Wait for the initial bundle to land.
    const mainJs = join(
      fixture.root,
      "dist",
      "packs",
      "BP",
      "scripts",
      "main.js",
    );
    const initialReady = await waitForCondition(async () => {
      try {
        const s = await stat(mainJs);
        return s.isFile();
      } catch {
        return false;
      }
    });
    expect(initialReady).toBe(true);

    // Confirm the initial item file is already mirrored too.
    const srcItem = join(
      fixture.root,
      "packs",
      "BP",
      "items",
      "example.item.json",
    );
    const distItem = join(
      fixture.root,
      "dist",
      "packs",
      "BP",
      "items",
      "example.item.json",
    );
    const distItemReady = await waitForCondition(async () => {
      try {
        const s = await stat(distItem);
        return s.isFile();
      } catch {
        return false;
      }
    });
    expect(distItemReady).toBe(true);

    // Modify a pack source file and wait for the mirror to update.
    const original = await readFile(srcItem, "utf8");
    const updated = original.replace(/}\s*$/, ',"_watched":true}');

    // Give chokidar a brief moment to finish its initial scan before we write.
    // Without this delay, on some platforms (Windows in particular) the
    // first writeFile races with watcher attachment.
    await new Promise((r) => setTimeout(r, 500));
    await writeFile(srcItem, updated);

    const mirroredUpdated = await waitForCondition(async () => {
      try {
        const content = await readFile(distItem, "utf8");
        return content.includes('"_watched":true');
      } catch {
        return false;
      }
    }, 8000);
    expect(mirroredUpdated).toBe(true);
  });
});
