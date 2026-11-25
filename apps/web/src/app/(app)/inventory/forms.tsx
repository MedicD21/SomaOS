'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import {
  addItem, addLocation, adjustStock, archiveLocation, receiveStock, setItemArchived, setPar, transferStock, useStock,
} from './actions';

type Opt = { id: string; label: string };
const opts = (o: Opt[]) => o.map((x) => <option key={x.id} value={x.id}>{x.label}</option>);

function ItemSelect({ id, items, error }: { id: string; items: Opt[]; error?: string }) {
  return <Field id={id} label="Item" error={error}><Select id={id} name="itemId" required>{opts(items)}</Select></Field>;
}

export function UseForm({ locationId, items }: { locationId: string; items: Opt[] }) {
  return (
    <ActionForm action={useStock} label="Use stock" submitLabel="Use stock" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="locationId" value={locationId} />
          <ItemSelect id="use-item" items={items} error={e.itemId} />
          <Field id="use-qty" label="Quantity" error={e.quantity}><Input id="use-qty" name="quantity" type="number" step="any" min="0" inputMode="decimal" required /></Field>
          <div className="sm:col-span-2"><Field id="use-reason" label="Note (optional)" error={e.reason}><Input id="use-reason" name="reason" /></Field></div>
        </div>
      )}
    </ActionForm>
  );
}

export function ReceiveForm({ locationId, items }: { locationId: string; items: Opt[] }) {
  return (
    <ActionForm action={receiveStock} label="Receive stock" submitLabel="Receive stock" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="locationId" value={locationId} />
          <ItemSelect id="rcv-item" items={items} error={e.itemId} />
          <Field id="rcv-qty" label="Quantity" error={e.quantity}><Input id="rcv-qty" name="quantity" type="number" step="any" min="0" inputMode="decimal" required /></Field>
          <div className="sm:col-span-2"><Field id="rcv-ref" label="Delivery note (optional)" error={e.reference}><Input id="rcv-ref" name="reference" /></Field></div>
        </div>
      )}
    </ActionForm>
  );
}

export function AdjustForm({ locationId, items }: { locationId: string; items: Opt[] }) {
  return (
    <ActionForm action={adjustStock} label="Adjust stock" submitLabel="Adjust stock" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="locationId" value={locationId} />
          <ItemSelect id="adj-item" items={items} error={e.itemId} />
          <Field id="adj-delta" label="Change (+ or −)" error={e.delta}><Input id="adj-delta" name="delta" type="number" step="any" inputMode="decimal" required /></Field>
          <div className="sm:col-span-2"><Field id="adj-reason" label="Reason" error={e.reason}><Input id="adj-reason" name="reason" required /></Field></div>
        </div>
      )}
    </ActionForm>
  );
}

export function TransferForm({ fromId, items, locations }: { fromId: string; items: Opt[]; locations: Opt[] }) {
  return (
    <ActionForm action={transferStock} label="Transfer stock" submitLabel="Transfer stock" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="fromId" value={fromId} />
          <ItemSelect id="trf-item" items={items} error={e.itemId} />
          <Field id="trf-qty" label="Quantity" error={e.quantity}><Input id="trf-qty" name="quantity" type="number" step="any" min="0" inputMode="decimal" required /></Field>
          <Field id="trf-to" label="Move to" error={e.toId}><Select id="trf-to" name="toId" required>{opts(locations.filter((l) => l.id !== fromId))}</Select></Field>
          <Field id="trf-note" label="Note (optional)" error={e.note}><Input id="trf-note" name="note" /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ParForm({ locationId, items }: { locationId: string; items: Opt[] }) {
  return (
    <ActionForm action={setPar} label="Set par level" submitLabel="Set par" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="locationId" value={locationId} />
          <ItemSelect id="par-item" items={items} error={e.itemId} />
          <Field id="par-par" label="Par (target)" error={e.par}><Input id="par-par" name="par" type="number" step="any" min="0" inputMode="decimal" required /></Field>
          <Field id="par-min" label="Critical at or below" error={e.min}><Input id="par-min" name="min" type="number" step="any" min="0" inputMode="decimal" defaultValue={0} /></Field>
        </div>
      )}
    </ActionForm>
  );
}

const CATEGORIES = [['medical', 'Medical'], ['station_supply', 'Station supply'], ['ppe', 'PPE'], ['other', 'Other']] as const;
const KINDS = [['storeroom', 'Storeroom'], ['station', 'Station'], ['apparatus', 'Apparatus'], ['compartment', 'Compartment'], ['container', 'Bag / container']] as const;

export function AddItemForm() {
  return (
    <ActionForm action={addItem} label="Add item" submitLabel="Add item" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="it-name" label="Name" error={e.name}><Input id="it-name" name="name" required /></Field>
          <Field id="it-unit" label="Unit" hint="each, box, pack…" error={e.unit}><Input id="it-unit" name="unit" defaultValue="each" required /></Field>
          <Field id="it-cat" label="Category" error={e.category}><Select id="it-cat" name="category" defaultValue="medical">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field id="it-sku" label="SKU (optional)" error={e.sku}><Input id="it-sku" name="sku" /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveItemForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return <ActionForm action={setItemArchived.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`} submitLabel={archived ? 'Restore' : 'Archive'} submitVariant="secondary" className="" />;
}

export function AddLocationForm({ parents, units }: { parents: Opt[]; units: Opt[] }) {
  return (
    <ActionForm action={addLocation} label="Add location" submitLabel="Add location" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="loc-name" label="Name" error={e.name}><Input id="loc-name" name="name" required /></Field>
          <Field id="loc-kind" label="Type" error={e.kind}><Select id="loc-kind" name="kind" defaultValue="station">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field id="loc-parent" label="Inside (optional)" error={e.parentId}><Select id="loc-parent" name="parentId" defaultValue=""><option value="">— Top level —</option>{opts(parents)}</Select></Field>
          <Field id="loc-unit" label="Station (optional)" hint="Who may stock it. Blank inherits from where it sits." error={e.orgUnitId}><Select id="loc-unit" name="orgUnitId" defaultValue=""><option value="">— None —</option>{opts(units)}</Select></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveLocationForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={archiveLocation.bind(null, id)} label={`Archive ${label}`} submitLabel="Archive" submitVariant="secondary" className="" />;
}
