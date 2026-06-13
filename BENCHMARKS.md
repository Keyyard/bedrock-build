# Benchmarks

Deploy/build throughput for `@keyyard/bedrock-build` against the alternatives,
plus the before/after for the Phase 2 I/O work.

> Reproduce with `npm run bench` (needs `regolith` on PATH and `npm install` in
> `../bench`). Numbers below are from one Windows 11 machine; treat them as
> directional, not absolute. Re-run on your own hardware before quoting.

## Workload

A real addon: 89 behavior-pack files + 230 resource-pack files (319 total,
~1.8 MB). Each tool produces the same deployed output. 5 to 7 trials per tool,
first dropped as warmup, `bedrock-build build --clean` for the full-build path.

## Before / after (this package, `build --clean`)

The Phase 2 change parallelized the esbuild bundle with the pack copy and gave
the copier bounded concurrency instead of one `copyFile` at a time. No language
rewrite: esbuild is already native, the cost was serial filesystem I/O.

| Version | min | median | mean |
|---|---|---|---|
| Before (serial bundle-then-copy, per-file await) | 602 ms | 684 ms | 669 ms |
| After (parallel bundle+copy, bounded-concurrency copier) | 471 ms | ~495 ms | ~493 ms |

About a 26% drop in build time on this workload, in TypeScript.

## Cross-tool snapshot (full build, new code)

| Tool | min | median | mean |
|---|---|---|---|
| regolith (Go) | 476 ms | 502 ms | 570 ms |
| bedrock-build (Node) | 488 ms | 543 ms | 526 ms |
| mct (`@minecraft/creator-tools`) | 1598 ms | 1653 ms | 1668 ms |

Reading it honestly: bedrock-build runs neck-and-neck with regolith (a compiled
Go binary) despite paying Node process startup on every invocation, with the
tightest run-to-run spread of the three, and is roughly 3x faster than
Microsoft's `mct`. In `watch`/`deploy --watch` the process stays resident, so
the per-invocation startup the full-build path pays here disappears entirely.
