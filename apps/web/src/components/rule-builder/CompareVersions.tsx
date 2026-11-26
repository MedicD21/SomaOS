'use client';
import { useMemo, useState } from 'react';
import {
  describeAccrualPolicy, describePattern, describePayRules, diffConfig,
  type AccrualPolicy, type PayRules, type ShiftPattern,
} from '@soma/schedule-engine';
import { Select } from '@/components/ui/field';
import { SECTIONS } from './specs';

export type VersionView = { version: number; status: string; fromDate: string | null; payload: unknown };
type Kind = 'pay' | 'accrual' | 'pattern';

const LABELS: Map<string, string> = new Map(
  [...SECTIONS.pay, ...SECTIONS.accrual].flatMap((s) => s.fields).map((f) => [f.path, f.label] as const),
);

function labelFor(path: string): string {
  const exact = LABELS.get(path);
  if (exact) return exact;
  const tier = /^tiers\.(\d+)\.(.+)$/.exec(path);
  if (tier) return `Tier ${Number(tier[1]) + 1}: ${tier[2]!.replace(/\./g, ' ')}`;
  const tierWhole = /^tiers\.(\d+)$/.exec(path);
  if (tierWhole) return `Tier ${Number(tierWhole[1]) + 1}`;
  const platoon = /^platoons\.(.+)$/.exec(path);
  if (platoon) return `Offset for shift "${platoon[1]}"`;
  return path.replace(/\./g, ' › ');
}

const show = (v: unknown): string => (v === undefined ? '(not set)' : typeof v === 'string' ? v : JSON.stringify(v));

function sentences(kind: Kind, payload: unknown, shiftKeys: string[]): string[] {
  try {
    if (kind === 'pay') return describePayRules(payload as PayRules);
    if (kind === 'accrual') return describeAccrualPolicy(payload as AccrualPolicy);
    return describePattern(payload as ShiftPattern, shiftKeys);
  } catch {
    return [];
  }
}

const name = (v: VersionView): string => `v${v.version} (${v.status === 'approved' ? `approved${v.fromDate ? ` from ${v.fromDate}` : ''}` : v.status})`;

/** Any two versions of a document, setting by setting, plus what changed in plain English. Read-only. */
export function CompareVersions({ uid, kind, versions, shiftKeys = [] }: { uid: string; kind: Kind; versions: VersionView[]; shiftKeys?: string[] }) {
  const sorted = useMemo(() => [...versions].sort((a, b) => b.version - a.version), [versions]);
  const draft = sorted.find((v) => v.status === 'draft');
  const approved = sorted.find((v) => v.status === 'approved');
  const [to, setTo] = useState<number>((draft ?? approved ?? sorted[0])?.version ?? 0);
  const [from, setFrom] = useState<number>(draft ? (approved?.version ?? 0) : (sorted.find((v) => v.version < to)?.version ?? 0));

  if (sorted.length === 0) return <p className="text-sm text-muted">There is only one version so far, so there is nothing to compare.</p>;
  const a = sorted.find((v) => v.version === from) ?? null;
  const b = sorted.find((v) => v.version === to) ?? sorted[0]!;
  const changes = diffConfig(a?.payload ?? null, b.payload);
  const before = a ? sentences(kind, a.payload, shiftKeys) : [];
  const after = sentences(kind, b.payload, shiftKeys);
  const removed = before.filter((s) => !after.includes(s));
  const added = after.filter((s) => !before.includes(s));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${uid}-from`} className="block text-sm font-medium">Compare</label>
          <Select id={`${uid}-from`} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            <option value={0}>Nothing (the first version)</option>
            {sorted.map((v) => <option key={v.version} value={v.version}>{name(v)}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${uid}-to`} className="block text-sm font-medium">With</label>
          <Select id={`${uid}-to`} value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {sorted.map((v) => <option key={v.version} value={v.version}>{name(v)}</option>)}
          </Select>
        </div>
      </div>
      {changes.length === 0 ? (
        <p role="status" className="text-sm">No settings differ between these versions.</p>
      ) : (
        <div role="region" aria-label="Differences between the versions" tabIndex={0} className="relative max-w-full overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="sr-only">Settings that differ between {a ? name(a) : 'nothing'} and {name(b)}</caption>
            <thead>
              <tr>
                <th scope="col" className="py-2 pr-3">Setting</th>
                <th scope="col" className="pr-3">{a ? `v${a.version}` : 'Before'}</th>
                <th scope="col">v{b.version}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.path} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">{labelFor(c.path)}</th>
                  <td className="pr-3 py-2 break-words">{show(c.before)}</td>
                  <td className="py-2 break-words">{show(c.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(added.length > 0 || removed.length > 0) && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">In plain English</p>
          <ul aria-label="What changed" className="list-disc space-y-1 pl-5">
            {removed.map((s) => <li key={`r-${s}`}><span className="text-muted">Was:</span> {s}</li>)}
            {added.map((s) => <li key={`a-${s}`}><span className="text-muted">Now:</span> {s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
