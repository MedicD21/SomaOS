/** Immutable dotted-path helpers for editing a rule document (`workPeriod.threshold`, `tiers.1.fromYears`). */

export type Doc = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function getAt(doc: unknown, path: string): unknown {
  let cur: unknown = doc;
  for (const k of path.split('.')) {
    if (Array.isArray(cur)) cur = cur[Number(k)];
    else if (isObj(cur)) cur = cur[k];
    else return undefined;
  }
  return cur;
}

function put(cur: unknown, keys: string[], value: unknown, remove: boolean): unknown {
  const [k, ...rest] = keys;
  if (k === undefined) return value;
  if (Array.isArray(cur)) {
    const copy = [...cur];
    const i = Number(k);
    if (rest.length === 0 && remove) copy.splice(i, 1);
    else copy[i] = put(copy[i], rest, value, remove);
    return copy;
  }
  const obj = isObj(cur) ? { ...cur } : {};
  if (rest.length === 0 && remove) delete obj[k];
  else obj[k] = put(obj[k], rest, value, remove);
  return obj;
}

export const setAt = <T>(doc: T, path: string, value: unknown): T => put(doc, path.split('.'), value, false) as T;
export const removeAt = <T>(doc: T, path: string): T => put(doc, path.split('.'), undefined, true) as T;

/** Every leaf path of a document (arrays by index), for coverage checks. */
export function leafPaths(v: unknown, prefix = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leafPaths(x, prefix ? `${prefix}.${i}` : String(i)));
  if (isObj(v)) return Object.keys(v).flatMap((k) => leafPaths(v[k], prefix ? `${prefix}.${k}` : k));
  return [prefix];
}
