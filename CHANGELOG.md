# Changelog

## 3.1.0

### `build` now mirrors the pack trees instead of only copying

A file deleted or moved in `packs/` is now deleted from `dist/` too.

Before, `build` copied forward and never removed anything, so renaming a
folder left the old path in `dist/` indefinitely — and `deploy` shipped both
copies. Bedrock loads them as two definitions of the same identifier and one
silently wins, which can mean an item ships without the components you gave
it, or an animation is overridden by the file it was meant to replace. The
symptoms look nothing like a stale build, so this could cost a long debugging
session.

`--clean` is now an optimisation rather than a requirement for correctness.
`watch` and `pack`, which both build with `clean: false`, stop drifting.

`<out>/packs/BP/scripts/` is exempt at both ends: the bundler owns it, and
`build` writes it concurrently with the pack mirror.

`build` is also incremental now — a file is re-copied only when its size
differs or the source is newer, the same rule `deploy` already used.

### `syncTree` takes options

Additive and backward compatible:

```ts
syncTree(src, dst, {
  skipSource: (rel) => rel.startsWith("scripts/"),  // never copy
  keepInDest: (rel) => rel.startsWith("scripts/"),  // never delete
});
```
