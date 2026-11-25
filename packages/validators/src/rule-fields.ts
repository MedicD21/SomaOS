/** Minimal shape of a zod issue, so this file does not depend on zod's internal types. */
type Issue = { path: PropertyKey[]; message: string; code: string; minimum?: unknown; maximum?: unknown; origin?: string };

const num = (v: unknown): string => String(typeof v === 'bigint' ? Number(v) : v);

/** zod's default wording is for developers; rewrite it for people, keep our own messages as written. */
function plainMessage(i: Issue): string {
  if (i.code === 'invalid_type') return 'Enter a number.';
  if (i.code === 'too_big' && i.origin === 'number') return `Enter a number no larger than ${num(i.maximum)}.`;
  if (i.code === 'too_small' && i.origin === 'number') return `Enter a number no smaller than ${num(i.minimum)}.`;
  if (i.code === 'too_big') return `Use at most ${num(i.maximum)}.`;
  if (i.code === 'too_small') return `Use at least ${num(i.minimum)}.`;
  if (i.code === 'invalid_union') return 'Choose one of the options.';
  if (/^Invalid /.test(i.message)) return 'Check this value.';
  return i.message;
}

/** Field errors keyed by dotted path (`workPeriod.multiplier`, `tiers.1.fromYears`); first message per path wins. */
export function issuesToFieldErrors(issues: readonly Issue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[i.path.map(String).join('.')] ??= plainMessage(i);
  return out;
}

/** Parses hand-edited JSON, reporting problems in plain English. */
export function parseJsonDocument(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `That is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Dotted paths present in the typed document but absent from the schema-parsed one (zod strips unknown
 * keys). The editor warns about them and keeps them in the stored document; engines ignore them.
 */
export function unknownPaths(raw: unknown, parsed: unknown, path = ''): string[] {
  if (Array.isArray(raw)) {
    const p = Array.isArray(parsed) ? parsed : [];
    return raw.flatMap((item, i) => unknownPaths(item, p[i], path ? `${path}.${i}` : String(i)));
  }
  if (raw !== null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const p = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return Object.keys(r)
      .sort()
      .flatMap((k) => (k in p ? unknownPaths(r[k], p[k], path ? `${path}.${k}` : k) : [path ? `${path}.${k}` : k]));
  }
  return [];
}
