# @keyyard/bedrock-build

[![npm](https://img.shields.io/npm/v/@keyyard/bedrock-build?color=cb3837&logo=npm)](https://www.npmjs.com/package/@keyyard/bedrock-build)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/EJ4swPKJNU)

Compiler and build tooling for Minecraft Bedrock script add-ons. Bundles a TypeScript entry through esbuild, mirrors behavior and resource packs into `dist/`, and ships hot-reload deploy + `.mcaddon` packaging.

Powers the **Custom Workspace** scaffolded by [`create-mc-bedrock`](https://www.npmjs.com/package/create-mc-bedrock). You usually don't install this directly; `npx create-mc-bedrock` does it for you.

## Install

```bash
npm install --save-dev @keyyard/bedrock-build
```

Or scaffold a ready-to-go project:

```bash
npx create-mc-bedrock
```

## Commands

```bash
bedrock-build build              # dev bundle into dist/
bedrock-build build --release    # minified, no sourcemaps
bedrock-build watch              # rebuild on source/pack changes
bedrock-build deploy             # build then copy dist/packs to com.mojang/development_*_packs/
bedrock-build deploy --watch     # hot reload to local Minecraft on save
bedrock-build pack               # release build + zip into dist/<name>-<version>.mcaddon
```

### Global flags

```text
-c, --config <path>   Path to bedrock.config.json (default: ./bedrock.config.json)
-v, --verbose         Verbose logging
-h, --help            Show help
--version             Show version
```

## Workspace layout

```text
my-addon/
  bedrock.config.json
  package.json
  tsconfig.json
  src/
    main.ts                  ← entry; bundled into BP/scripts/main.js
  packs/
    BP/  manifest.json + behavior pack files
    RP/  manifest.json + resource pack files
  dist/                      ← build output (gitignored)
```

## `bedrock.config.json`

```json
{
  "name": "my-addon",
  "version": "1.0.0",
  "packs": { "bp": "packs/BP", "rp": "packs/RP" },
  "entry": "src/main.ts",
  "out": "dist",
  "deploy": {
    "target": "retail",
    "customPath": null
  },
  "minecraft": {
    "serverVersion": "1.19.0"
  }
}
```

Full schema reference: <https://bedrockcli.keyyard.xyz/docs/reference/config-schema>

## Deploy targets

- **`retail`** (Windows): auto-detects across six known Bedrock install layouts in priority order: the modern Minecraft Bedrock launcher (`%APPDATA%\Minecraft Bedrock\Users\Shared\games\com.mojang`), Bedrock Preview launcher, Microsoft Store UWP, UWP Beta, and both Education editions.
- **`custom`**: set `deploy.customPath` to any directory containing `development_behavior_packs/` and `development_resource_packs/`. Works on all platforms.

Mac/Linux retail deploy is on the roadmap.

## Programmatic API

```typescript
import { build, watch, deploy, pack, loadConfig } from "@keyyard/bedrock-build";

const config = await loadConfig("./bedrock.config.json");
await build(config, { release: false, clean: true });
```

Exported types: `BedrockConfig`, `BuildOptions`, `WatchOptions`, `DeployOptions`, `PackOptions`, `BuildResult`, `DeployTargets`. Errors: `ConfigError`, `DeployTargetError`.

## Requirements

- Node.js 18 or higher
- For `deploy` retail: Windows. Custom deploy paths work everywhere.

## Docs

Full guides, reference, and cookbook at **<https://bedrockcli.keyyard.xyz/docs>**.

## License

MIT
