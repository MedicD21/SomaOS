/** One changed setting between two versions of a rule document. */
export type ConfigChange = { path: string; before: unknown; after: unknown };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every leaf of a document as a dotted path, in sorted key order. */
function leaves(v: unknown, path: string, out: { path: string; value: unknown }[]): void {
  if (isObject(v)) {
    for (const k of Object.keys(v).sort()) leaves(v[k], path ? `${path}.${k}` : k, out);
  } else if (Array.isArray(v)) {
    v.forEach((item, i) => leaves(item, path ? `${path}.${i}` : String(i), out));
  } else {
    out.push({ path, value: v });
  }
}

function walk(a: unknown, b: unknown, path: string, out: ConfigChange[]): void {
  if (isObject(a) && isObject(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      walk(a[k], b[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], path ? `${path}.${i}` : String(i), out);
    return;
  }
  // An added or removed key or array item is reported once, whole; otherwise compare leaf values.
  if (a === undefined || b === undefined || typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || a !== b) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, before: a, after: b });
  }
}

/**
 * Leaf-level differences between two versions of a document, ordered by path. Array items are matched
 * by index. With no earlier version (null) every setting counts as added.
 */
export function diffConfig<T>(before: T | null, after: T): ConfigChange[] {
  if (before === null) {
    const all: { path: string; value: unknown }[] = [];
    leaves(after, '', all);
    return all.map((l) => ({ path: l.path, before: undefined, after: l.value }));
  }
  const out: ConfigChange[] = [];
  walk(before, after, '', out);
  return out;
}
