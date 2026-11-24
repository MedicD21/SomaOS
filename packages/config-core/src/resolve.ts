export type ConfigVersion<T> = {
  kind: string;
  key: string;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  payload: T;
};

/** The version whose half-open interval [effectiveFrom, effectiveTo) contains `at`. */
export function resolveEffective<T>(versions: ConfigVersion<T>[], at: Date): ConfigVersion<T> | null {
  const t = at.getTime();
  return (
    versions.find(
      (v) => v.effectiveFrom.getTime() <= t && (v.effectiveTo === null || t < v.effectiveTo.getTime()),
    ) ?? null
  );
}

export type Layer<T> = { name: string; payload: Partial<T> };

type Plain = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Plain =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

function mergeInto(target: Plain, source: Plain, layer: string, prefix: string, sources: Record<string, string>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      const existing = target[key];
      const next: Plain = isPlainObject(existing) ? existing : {};
      if (!isPlainObject(existing)) {
        for (const p of Object.keys(sources)) if (p === path || p.startsWith(`${path}.`)) delete sources[p];
      }
      target[key] = next;
      mergeInto(next, value, layer, path, sources);
    } else {
      for (const p of Object.keys(sources)) if (p.startsWith(`${path}.`)) delete sources[p];
      target[key] = value;
      sources[path] = layer;
    }
  }
}

/**
 * Merges layers ordered most-general first (e.g. platform → state → tenant).
 * Plain objects deep-merge, arrays and scalars replace. `sources` maps each leaf
 * path to the layer that set it.
 */
export function resolveLayered<T extends object>(layers: Layer<T>[]): { value: T; sources: Record<string, string> } {
  const value: Plain = {};
  const sources: Record<string, string> = {};
  for (const layer of layers) mergeInto(value, layer.payload as Plain, layer.name, '', sources);
  return { value: value as T, sources };
}
