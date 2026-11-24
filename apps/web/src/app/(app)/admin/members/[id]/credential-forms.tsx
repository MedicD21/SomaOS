'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addCredential, revokeCredential } from '../actions';

export function AddCredentialForm({ memberId, types }: { memberId: string; types: { id: string; label: string }[] }) {
  return (
    <ActionForm action={addCredential.bind(null, memberId)} label="Add credential" submitLabel="Add credential" resetOnSuccess>
      {(e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="cred-type" label="Credential type" error={e.typeId}>
              <Select id="cred-type" name="typeId" required>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
            </Field>
            <Field id="cred-number" label="Number" error={e.number}><Input id="cred-number" name="number" maxLength={60} /></Field>
            <Field id="cred-issued" label="Issued on" error={e.issuedOn}><Input id="cred-issued" name="issuedOn" type="date" required /></Field>
          </div>
          <p className="text-sm text-muted">The expiry date is calculated from the credential type.</p>
        </>
      )}
    </ActionForm>
  );
}

export function RevokeCredentialForm({ credentialId, label }: { credentialId: string; label: string }) {
  return (
    <ActionForm action={revokeCredential.bind(null, credentialId)} label={`Revoke ${label}`} submitLabel="Revoke" submitVariant="danger" className="space-y-2" />
  );
}
