/** 2-space indent + trailing newline, matching the seeded starter style. */
export function renderJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}
