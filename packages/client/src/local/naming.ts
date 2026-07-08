/**
 * Single source of truth for namespaced storage names (IDB database name,
 * mutation-queue storage keys). Omitting `namespace` reproduces the
 * pre-namespace (rc2) name exactly.
 */
export function composeName(base: string, namespace?: string): string {
  return namespace ? `${base}:${namespace}` : base
}
