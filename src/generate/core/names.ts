/**
 * Name derivation. One feature name + namespace → the various forms generators
 * need. SPEC §3.6: atlas keys are namespaced `<ns>_<name>`; the texture PATH is
 * icon-derived; `minecraft:icon` references the KEY, never a path.
 */

export interface DerivedNames {
  /** The validated feature name (snake_case). */
  name: string;
  /** Project namespace. */
  namespace: string;
  /** Full identifier `<ns>:<name>`. */
  identifier: string;
  /** Namespaced atlas key `<ns>_<name>` — used by minecraft:icon / material_instances.texture. */
  atlasKey: string;
  /** Title-cased display name, e.g. `fire_sword` → `Fire Sword`. */
  displayName: string;
}

/** `fire_sword` → `Fire Sword`. Pure: splits on underscore, capitalizes each. */
export function toDisplayName(name: string): string {
  return name
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Strip a trailing `.png` from a texture/icon reference. SPEC §3.5: a common
 * author error; the registry path stores the bare reference.
 */
export function stripPng(ref: string): string {
  return ref.replace(/\.png$/i, "");
}

/**
 * Derive every name form from a namespace + feature name. The optional
 * `displayName` overrides the Title-Case default.
 */
export function deriveNames(
  namespace: string,
  name: string,
  displayName?: string,
): DerivedNames {
  return {
    name,
    namespace,
    identifier: `${namespace}:${name}`,
    atlasKey: `${namespace}_${name}`,
    displayName: displayName && displayName.trim() !== "" ? displayName : toDisplayName(name),
  };
}
