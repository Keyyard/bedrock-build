/**
 * Pinned, stable `format_version` constants. SPEC §5: stable-only, each a named
 * constant, documented as bumpable. 1.21.80+ enforces the block
 * geometry/material pairing the block generator already satisfies.
 *
 * NOTE: Geometry and animation files are NOT generated (they are user-imported,
 * see §4.1/§4.3/§4.5), so NO geometry/animation version is pinned here.
 */
export const VERSIONS = {
  /** create:item, create:weapon, create:tool BP item files. */
  item: "1.21.80",
  /** create:armor BP item file (intentionally older — armor item schema). */
  armorItem: "1.20.80",
  /** create:block BP block file. */
  block: "1.21.50",
  /** create:entity BP entity file. */
  bpEntity: "1.21.40",
  /** create:entity RP client_entity (intentionally old — do NOT sync up). */
  clientEntity: "1.10.0",
  /** RP attachable files (weapon/armor 3D). */
  attachable: "1.10.0",
  /** RP render_controllers files (3D custom controllers). */
  renderController: "1.10.0",
  /** blocks.json registry. */
  blocksJson: "1.10.0",
} as const;
