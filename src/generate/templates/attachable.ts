import { renderJson } from "./serialize.js";
import { VERSIONS } from "../core/versions.js";

/**
 * Attachable render functions. SPEC §4.1 (weapon 3D) / §4.3 (armor 3D).
 *
 * The attachable identifier MUST equal the item identifier. Geometry, texture,
 * and animation are USER-IMPORTED — the attachable only references them. 3D
 * attachables use a CUSTOM render controller (§3.6 convention 3): vanilla
 * controllers do not reliably render custom geometry.
 */

export interface WeaponAttachableOptions {
  identifier: string;
  /** Geometry id (user-supplied), default geometry.<ns>.<name>. */
  geometry: string;
  /** Texture path (no .png), default textures/<ns>/items/<name>. */
  texture: string;
  /** Custom render controller id, controller.render.<ns>_<name>. */
  renderController: string;
  /** Animation id prefix, default animation.<ns>.<name>. */
  animationPrefix: string;
}

/**
 * Held-item (weapon) attachable. Wires first_person/third_person animations +
 * scripts.animate so a matching model + animation drop in immediately.
 */
export function renderWeaponAttachableJson(opts: WeaponAttachableOptions): string {
  return renderJson({
    format_version: VERSIONS.attachable,
    "minecraft:attachable": {
      description: {
        identifier: opts.identifier,
        materials: { default: "entity_alphatest", enchanted: "entity_alphatest_glint" },
        textures: {
          default: opts.texture,
          enchanted: "textures/misc/enchanted_item_glint",
        },
        geometry: { default: opts.geometry },
        animations: {
          first_person: `${opts.animationPrefix}.first_person`,
          third_person: `${opts.animationPrefix}.third_person`,
        },
        scripts: {
          animate: [
            { first_person: "c.is_first_person" },
            { third_person: "!c.is_first_person" },
          ],
        },
        render_controllers: [opts.renderController],
      },
    },
  });
}

export interface ArmorAttachableOptions {
  identifier: string;
  /** Geometry id (user-supplied). */
  geometry: string;
  /** Texture path (no .png), user-supplied. */
  texture: string;
  /** Custom render controller id, controller.render.<ns>_<name>. */
  renderController: string;
}

/** Worn (armor) attachable. SPEC §4.3 3D mode. */
export function renderArmorAttachableJson(opts: ArmorAttachableOptions): string {
  return renderJson({
    format_version: VERSIONS.attachable,
    "minecraft:attachable": {
      description: {
        identifier: opts.identifier,
        materials: { default: "armor", enchanted: "armor_enchanted" },
        textures: {
          default: opts.texture,
          enchanted: "textures/misc/enchanted_item_glint",
        },
        geometry: { default: opts.geometry },
        render_controllers: [opts.renderController],
      },
    },
  });
}
