'use client';
import { ActionForm } from '@/components/action-form';
import { sendInvite } from '../actions';

export function InviteForm({ memberId, email }: { memberId: string; email: string }) {
  return (
    <ActionForm action={sendInvite.bind(null, memberId)} label="Invite to sign in" submitLabel="Send sign-in invitation" submitVariant="secondary">
      <p className="text-sm">This member has no SomaOS login yet. An invitation will be emailed to <strong>{email}</strong>.</p>
    </ActionForm>
  );
}
