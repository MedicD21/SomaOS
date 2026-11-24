import { localDateOf } from '@soma/schedule-engine';
import { FileUpload } from '@/components/file-upload';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { AddCredentialForm, RevokeCredentialForm } from './credential-forms';

type CredentialRow = { id: string; type: string; number: string | null; issued_on: string; expires_on: string | null; status: string };

/**
 * A member's credentials. Read: department credentials.view, or the member's own record (RLS
 * enforces the same rule). Write: department credentials.manage. Documents are HR attachments.
 */
export async function CredentialsSection({ memberId }: { memberId: string }) {
  const ctx = await getRequestContext();
  const canView = ctx.memberId === memberId || check(ctx, 'credentials.view').allowed;
  const canManage = check(ctx, 'credentials.manage').allowed;
  if (!canView && !canManage) return null;
  const canSeeFiles = hasAny(ctx, 'files.view');
  const canUpload = canManage && hasAny(ctx, 'files.upload');
  const today = localDateOf(new Date(), ctx.tenant.timezone);

  const { creds, docs, types } = await withCtxDb(ctx, async (tx) => {
    const creds = canView
      ? [...(await tx<CredentialRow[]>`
          select c.id, t.label as type, c.number, c.issued_on::text as issued_on, c.expires_on::text as expires_on, c.status
          from member_credentials c join credential_types t on t.id = c.type_id
          where c.member_id = ${memberId} and c.tenant_id = app.tenant_id()
          order by c.status, t.label, c.issued_on desc`)]
      : [];
    const docs = canSeeFiles && creds.length
      ? [...(await tx<{ id: string; entity_id: string; file_name: string }[]>`
          select id, entity_id, file_name from attachments
          where entity = 'member_credential' and entity_id = any (${creds.map((c) => c.id)}::uuid[])
          order by uploaded_at`)]
      : [];
    const types = canManage ? [...(await tx<{ id: string; label: string }[]>`select id, label from credential_types where status = 'active' order by label`)] : [];
    return { creds, docs, types };
  });

  return (
    <Card title="Credentials">
      {canView && (creds.length === 0 ? <p className="mb-4 text-muted">No credentials recorded.</p> : (
        <div className="relative mb-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Credentials</caption>
            <thead>
              <tr>
                <th scope="col" className="py-2 pr-3">Type</th>
                <th scope="col" className="pr-3">Number</th>
                <th scope="col" className="pr-3">Issued</th>
                <th scope="col" className="pr-3">Expires</th>
                <th scope="col" className="pr-3">Documents</th>
                {canManage && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {creds.map((c) => {
                const expired = c.expires_on !== null && c.expires_on < today;
                const label = `${c.type}${c.number ? ` ${c.number}` : ''}`;
                return (
                  <tr key={c.id} className="border-t border-line align-top">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {c.type}
                      {c.status === 'revoked' && <span className="block text-xs font-normal text-muted">Revoked</span>}
                    </th>
                    <td className="py-2 pr-3">{c.number ?? '—'}</td>
                    <td className="py-2 pr-3">{c.issued_on}</td>
                    <td className={`py-2 pr-3 ${expired ? 'font-semibold text-danger' : ''}`}>
                      {c.expires_on ?? 'Never'}{expired && ' (expired)'}
                    </td>
                    <td className="py-2 pr-3">
                      <ul className="space-y-1">
                        {docs.filter((d) => d.entity_id === c.id).map((d) => (
                          <li key={d.id}><a className="underline" href={`/files/${d.id}`}>{d.file_name}</a></li>
                        ))}
                      </ul>
                      {canUpload && c.status === 'active' && (
                        <details>
                          <summary className="inline-flex min-h-11 cursor-pointer items-center underline">Add document</summary>
                          <FileUpload entity="member_credential" entityId={c.id} label={`Upload document for ${label}`} fieldLabel="Document" />
                        </details>
                      )}
                    </td>
                    {canManage && (
                      <td className="py-2">{c.status === 'active' && <RevokeCredentialForm credentialId={c.id} label={label} />}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {canManage && (types.length === 0 ? <p className="text-muted">Add credential types first.</p> : <AddCredentialForm memberId={memberId} types={types} />)}
    </Card>
  );
}
