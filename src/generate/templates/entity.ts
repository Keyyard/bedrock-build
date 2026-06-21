import { renderJson } from "./serialize.js";
import { VERSIONS } from "../core/versions.js";

/**
 * Entity render functions. SPEC §4.5. Emits the pair: a minimal-but-alive
 * walking mob (BP, format_version 1.21.40) and a client_entity (RP,
 * format_version 1.10.0 — intentionally old, do NOT sync up).
 */

export interface BpEntityOptions {
  identifier: string;
  /** type_family first family token, derived from the name. */
  family: string;
}

/** Minimal-but-alive walking mob. SPEC §4.5 skeleton. */
export function renderBpEntityJson(opts: BpEntityOptions): string {
  return renderJson({
    format_version: VERSIONS.bpEntity,
    "minecraft:entity": {
      description: {
        identifier: opts.identifier,
        spawn_category: "creature",
        is_spawnable: true,
        is_summonable: true,
      },
      components: {
        "minecraft:type_family": { family: [opts.family, "mob"] },
        "minecraft:health": { value: 10, max: 10 },
        "minecraft:collision_box": { width: 0.6, height: 1.8 },
        "minecraft:physics": {},
        "minecraft:pushable": { is_pushable: true, is_pushable_by_piston: true },
        "minecraft:movement": { value: 0.25 },
        "minecraft:movement.basic": {},
        "minecraft:navigation.walk": { can_path_over_water: true, avoid_water: true },
        "minecraft:jump.static": {},
        "minecraft:behavior.float": { priority: 0 },
        "minecraft:behavior.random_stroll": { priority: 6, speed_multiplier: 1.0 },
        "minecraft:behavior.look_at_player": {
          priority: 7,
          look_distance: 6.0,
          probability: 0.02,
        },
        "minecraft:behavior.random_look_around": { priority: 8 },
      },
    },
  });
}

export interface ClientEntityOptions {
  identifier: string;
  /** Geometry id (3D, user-supplied) — defaults to geometry.<ns>.<name>. */
  geometry: string;
  /** Texture path (no .png), e.g. textures/entity/<name>. */
  texture: string;
  /** Spawn egg base color. */
  baseColor: string;
  /** Spawn egg overlay color. */
  overlayColor: string;
}

/** 3D client_entity referencing user-supplied geometry/texture. SPEC §4.5. */
export function renderClientEntity3dJson(opts: ClientEntityOptions): string {
  return renderJson({
    format_version: VERSIONS.clientEntity,
    "minecraft:client_entity": {
      description: {
        identifier: opts.identifier,
        materials: { default: "entity_alphatest" },
        textures: { default: opts.texture },
        geometry: { default: opts.geometry },
        render_controllers: ["controller.render.default"],
        spawn_egg: { base_color: opts.baseColor, overlay_color: opts.overlayColor },
      },
    },
  });
}

/** 2D billboard-sprite client_entity. SPEC §4.5. */
export function renderClientEntity2dJson(opts: ClientEntityOptions): string {
  return renderJson({
    format_version: VERSIONS.clientEntity,
    "minecraft:client_entity": {
      description: {
        identifier: opts.identifier,
        materials: { default: "snowball" },
        textures: { default: opts.texture },
        geometry: { default: "geometry.item_sprite" },
        render_controllers: ["controller.render.item_sprite"],
        animations: { flying: "animation.actor.billboard" },
        scripts: { animate: ["flying"] },
        spawn_egg: { base_color: opts.baseColor, overlay_color: opts.overlayColor },
      },
    },
  });
}
