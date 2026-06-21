/**
 * Bedrock identifier validation + namespace derivation. SPEC §3.5 / §3.2.
 *
 * Name validation is strict and friendly — no silent auto-fixing. The
 * user-entered name must be pure lowercase letters + underscores (snake_case;
 * no digits). On a bad name, do not sanitize silently; return a clear message.
 */

/** Namespaces reserved for vanilla content. */
const RESERVED = new Set(["minecraft", "minecon"]);

/**
 * Validate a feature name. Pure lowercase letters + underscores, must start
 * with a letter. Returns `true` or a friendly error string.
 */
export function validateName(raw: string): true | string {
  if (!/^[a-z][a-z_]*$/.test(raw)) {
    return `"${raw}" isn't a valid name. Use lowercase letters and underscores only — no spaces, numbers, or special characters — e.g. item_name.`;
  }
  return true;
}

/**
 * Validate a full `namespace:name` identifier. Returns `true` or a friendly
 * error string. Rejects the reserved vanilla namespaces.
 */
export function validateIdentifier(id: string): true | string {
  const m = /^([a-z][a-z_]*):([a-z][a-z_]*)$/.exec(id);
  if (!m) {
    return "Use namespace:name — lowercase letters and underscores only (e.g. my_addon:fire_sword).";
  }
  if (RESERVED.has(m[1]!)) {
    return `The "${m[1]}" namespace is reserved for vanilla content.`;
  }
  return true;
}

/**
 * Validate a bare namespace string (no colon). Returns `true` or a friendly
 * error string.
 */
export function validateNamespace(ns: string): true | string {
  if (!/^[a-z][a-z_]*$/.test(ns)) {
    return `"${ns}" isn't a valid namespace. Use lowercase letters and underscores only (e.g. my_addon).`;
  }
  if (RESERVED.has(ns)) {
    return `The "${ns}" namespace is reserved for vanilla content.`;
  }
  return true;
}

/**
 * Sanitize an arbitrary project name into a legal Bedrock namespace. SPEC §3.2.
 * Lowercase, non-alphanumeric runs → `_`, trim leading/trailing `_`, prefix a
 * leading digit, and never return empty.
 */
export function deriveNamespace(name: string): string {
  const ns = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "ns_$1");
  return ns || "ns";
}
