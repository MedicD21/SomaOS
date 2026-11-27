'use client';
import { useState, type DragEvent } from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import {
  addToMandateList,
  clearMandateExemption,
  createMandateList,
  exemptFromMandate,
  recordMandate,
  removeFromMandateList,
  reorderMandateList,
  skipForMandate,
} from './actions';

type Opt = { id: string; label: string };

export type EntryRow = {
  memberId: string;
  name: string;
  position: number;
  status: string;
  statusLabel: string;
  detail: string | null;
  exempt: boolean;
};

export function CreateListForm() {
  return (
    <ActionForm action={createMandateList} label="Create a mandate list" submitLabel="Create list" resetOnSuccess>
      {(e) => (
        <Field id="ml-name" label="List name" hint="For example “ALS mandate list” or “A platoon”." error={e.name}>
          <Input id="ml-name" name="name" required maxLength={80} />
        </Field>
      )}
    </ActionForm>
  );
}

export function AddMemberForm({ listId, members }: { listId: string; members: Opt[] }) {
  return (
    <ActionForm action={addToMandateList.bind(null, listId)} label="Add a member to the list" submitLabel="Add to bottom" resetOnSuccess>
      {(e) => (
        <Field id="ml-add" label="Member" error={e.memberId}>
          <Select id="ml-add" name="memberId" required defaultValue="">
            <option value="" disabled>Choose a member</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
      )}
    </ActionForm>
  );
}

const STATUS_STYLE: Record<string, string> = {
  eligible: 'border-brand font-semibold',
  exempt: 'text-muted',
  separated: 'text-muted',
};

/**
 * The ordered list. Officers drag rows, or use Move up / Move down (keyboard and screen-reader
 * friendly), then save the new order with a reason. Row actions sit in a disclosure per member.
 */
export function OrderEditor({ listId, entries, canManage, date }: { listId: string; entries: EntryRow[]; canManage: boolean; date: string }) {
  const [order, setOrder] = useState(entries.map((e) => e.memberId));
  const [dragging, setDragging] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const byId = new Map(entries.map((e) => [e.memberId, e]));
  const changed = order.some((id, i) => id !== entries[i]?.memberId);
  const nextUp = entries.find((e) => e.status === 'eligible')?.memberId ?? null;

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id!);
    setOrder(next);
    setAnnounce(`${byId.get(id!)?.name ?? 'Member'} moved to position ${to + 1} of ${next.length}. Save the order to keep it.`);
  }

  function onDrop(e: DragEvent<HTMLLIElement>, targetId: string) {
    e.preventDefault();
    if (!dragging) return;
    move(order.indexOf(dragging), order.indexOf(targetId));
    setDragging(null);
  }

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="sr-only">{announce}</p>
      <ol aria-label="Mandate order" className="space-y-2">
        {order.map((id, i) => {
          const e = byId.get(id)!;
          return (
            <li
              key={id}
              draggable={canManage}
              onDragStart={() => setDragging(id)}
              onDragOver={(ev) => canManage && ev.preventDefault()}
              onDrop={(ev) => onDrop(ev, id)}
              onDragEnd={() => setDragging(null)}
              data-testid="mandate-row"
              className={`rounded-md border border-line bg-surface p-3 ${dragging === id ? 'opacity-50' : ''} ${canManage ? 'cursor-grab' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-8 text-right font-mono text-sm" aria-hidden="true">{i + 1}.</span>
                <span className="font-medium">{e.name}</span>
                <span className={`rounded border border-line px-1.5 py-0.5 text-xs ${STATUS_STYLE[e.status] ?? ''}`}>
                  {id === nextUp ? 'Next up' : e.statusLabel}
                </span>
                {e.detail && <span className="text-sm text-muted">{e.detail}</span>}
                {canManage && (
                  <span className="ml-auto flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${e.name} up`}>
                      Up
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label={`Move ${e.name} down`}>
                      Down
                    </Button>
                  </span>
                )}
              </div>
              {canManage && !changed && <RowActions listId={listId} entry={e} date={date} />}
            </li>
          );
        })}
      </ol>
      {canManage && changed && (
        <div className="rounded-md border border-line p-4">
          <ActionForm action={reorderMandateList.bind(null, listId, order)} label="Save the new order" submitLabel="Save order">
            {(err) => (
              <Field id="ml-reason" label="Why is the order changing?" hint="Recorded in the list history." error={err.reason}>
                <Input id="ml-reason" name="reason" required />
              </Field>
            )}
          </ActionForm>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => setOrder(entries.map((e) => e.memberId))}>
            Undo changes
          </Button>
        </div>
      )}
    </div>
  );
}

function RowActions({ listId, entry, date }: { listId: string; entry: EntryRow; date: string }) {
  const id = entry.memberId;
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold">Change {entry.name}</summary>
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        {entry.exempt ? (
          <ActionForm action={clearMandateExemption.bind(null, listId, id)} label={`Clear exemption for ${entry.name}`} submitLabel="Clear exemption" submitVariant="secondary" className="space-y-2" />
        ) : (
          <ActionForm action={exemptFromMandate.bind(null, listId, id)} label={`Exempt ${entry.name}`} submitLabel="Exempt" submitVariant="secondary" className="space-y-2">
            {(e) => (
              <>
                <Field id={`ex-${id}`} label="Exemption reason" error={e.reason}><Input id={`ex-${id}`} name="reason" required /></Field>
                <Field id={`exu-${id}`} label="Until (optional)" hint="Last exempt day; blank until cleared." error={e.until}>
                  <Input id={`exu-${id}`} name="until" type="date" />
                </Field>
              </>
            )}
          </ActionForm>
        )}
        <ActionForm action={skipForMandate.bind(null, listId, id, date)} label={`Skip ${entry.name}`} submitLabel={`Skip for ${date}`} submitVariant="secondary" className="space-y-2">
          {(e) => <Field id={`sk-${id}`} label="Skip reason" hint="Keeps their place on the list." error={e.reason}><Input id={`sk-${id}`} name="reason" required /></Field>}
        </ActionForm>
        <ActionForm action={removeFromMandateList.bind(null, listId, id)} label={`Remove ${entry.name}`} submitLabel="Remove from list" submitVariant="danger" className="space-y-2">
          {(e) => <Field id={`rm-${id}`} label="Removal reason" error={e.reason}><Input id={`rm-${id}`} name="reason" required /></Field>}
        </ActionForm>
      </div>
    </details>
  );
}

export function MandateForm({
  listId,
  candidates,
  nextId,
  seats,
  date,
  startTime,
  hours,
  canOverride,
}: {
  listId: string;
  candidates: Opt[];
  nextId: string | null;
  seats: Opt[];
  date: string;
  startTime: string;
  hours: number;
  canOverride: boolean;
}) {
  return (
    <ActionForm action={recordMandate.bind(null, listId)} label="Mandate a member" submitLabel="Mandate" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="md-member" label="Member" hint="The next member up is chosen for you." error={e.memberId}>
            <Select id="md-member" name="memberId" required defaultValue={nextId ?? ''}>
              {!nextId && <option value="" disabled>Choose a member</option>}
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field id="md-seat" label="Vacant seat" error={e.seatId}>
            <Select id="md-seat" name="seatId" required>{seats.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          </Field>
          <Field id="md-date" label="Date" error={e.date}><Input id="md-date" name="date" type="date" defaultValue={date} required /></Field>
          <Field id="md-start" label="Start time" error={e.startTime}><Input id="md-start" name="startTime" type="time" defaultValue={startTime} required /></Field>
          <Field id="md-hours" label="Hours" error={e.hours}><Input id="md-hours" name="hours" type="number" min={1} max={48} step={1} defaultValue={hours} required /></Field>
          <Field id="md-reason" label="Note (optional)" hint="For example “Department at 23 of 25 ALS”." error={e.reason}><Input id="md-reason" name="reason" /></Field>
          {canOverride && (
            <Field id="md-override" label="Override reason" hint="Only needed when a qualification rule blocks this member." error={e.overrideReason}>
              <Input id="md-override" name="overrideReason" />
            </Field>
          )}
        </div>
      )}
    </ActionForm>
  );
}
