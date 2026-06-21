import { renderJson } from "./serialize.js";
import { VERSIONS } from "../core/versions.js";

/**
 * Minimal custom render controller. SPEC §3.6 convention 3: 3D weapon/armor
 * ship their own controller because the vanilla `controller.render.item_default`
 * / `controller.render.armor` do not reliably render CUSTOM geometry.
 *
 * The controller id is `controller.render.<ns>_<name>` and selects the
 * attachable's `Geometry.default`, `Material.default`, and `Texture.default`.
 */
export interface RenderControllerOptions {
  /** controller.render.<ns>_<name>. */
  id: string;
}

export function renderRenderControllerJson(opts: RenderControllerOptions): string {
  return renderJson({
    format_version: VERSIONS.renderController,
    render_controllers: {
      [opts.id]: {
        geometry: "Geometry.default",
        materials: [{ "*": "Material.default" }],
        textures: ["Texture.default"],
      },
    },
  });
}
