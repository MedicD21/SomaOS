'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { decideTrade, proposeTrade, respondTrade, withdrawTrade } from './actions';

type Opt = { id: string; label: string };

export function ProposeTradeForm({ mine, others }: { mine: Opt[]; others: Opt[] }) {
  return (
    <ActionForm action={proposeTrade} label="Propose a trade" submitLabel="Propose trade" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tr-mine" label="Your shift" error={e.mineId}>
            <Select id="tr-mine" name="mineId" required>{mine.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          </Field>
          <Field id="tr-theirs" label="Their shift" error={e.theirsId}>
            <Select id="tr-theirs" name="theirsId" required>{others.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          </Field>
          <div className="sm:col-span-2">
            <Field id="tr-note" label="Note (optional)" error={e.note}><Input id="tr-note" name="note" maxLength={300} /></Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function RespondForm({ id, accept, who }: { id: string; accept: boolean; who: string }) {
  return (
    <ActionForm action={respondTrade.bind(null, id, accept)} label={`${accept ? 'Accept' : 'Decline'} trade with ${who}`}
      submitLabel={accept ? 'Accept' : 'Decline'} submitVariant={accept ? 'primary' : 'secondary'} className="space-y-2" />
  );
}

export function WithdrawForm({ id, who }: { id: string; who: string }) {
  return <ActionForm action={withdrawTrade.bind(null, id)} label={`Withdraw trade with ${who}`} submitLabel="Withdraw" submitVariant="secondary" className="space-y-2" />;
}

export function ApproveForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={decideTrade.bind(null, id, true)} label={`Approve ${label}`} submitLabel="Approve trade" className="space-y-2">
      {(e) => (
        <Field id={`ov-${id}`} label="Override reason" hint="Only needed when the trade is blocked by a qualification rule." error={e.overrideReason}>
          <Input id={`ov-${id}`} name="overrideReason" />
        </Field>
      )}
    </ActionForm>
  );
}

export function DenyForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={decideTrade.bind(null, id, false)} label={`Deny ${label}`} submitLabel="Deny trade" submitVariant="secondary" className="space-y-2">
      {(e) => (
        <Field id={`dn-${id}`} label="Note (optional)" error={e.note}><Input id={`dn-${id}`} name="note" /></Field>
      )}
    </ActionForm>
  );
}
