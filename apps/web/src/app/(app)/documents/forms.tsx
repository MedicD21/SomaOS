'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { archiveDocument, createDocument, publishVersion, saveFolder, uploadVersion } from './actions';

type Opt = { id: string; label: string };

const VIEW_PERMISSIONS = [
  ['', 'Everyone who can use the library'],
  ['admin.members.manage', 'HR: member managers only'],
  ['pay.manage', 'Payroll managers only'],
  ['admin.config.manage', 'Chief and administrators only'],
] as const;

export function FolderForm({ folders }: { folders: Opt[] }) {
  return (
    <ActionForm action={saveFolder} label="New folder" submitLabel="Add folder" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="fo-name" label="Folder name" error={e.name}><Input id="fo-name" name="name" required /></Field>
          <Field id="fo-parent" label="Inside" error={e.parentId}>
            <Select id="fo-parent" name="parentId" defaultValue="">
              <option value="">Top level</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
          <Field id="fo-view" label="Who can see it" hint="A restricted folder hides everything inside it." error={e.viewPermission}>
            <Select id="fo-view" name="viewPermission" defaultValue="">
              {VIEW_PERMISSIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function DocumentForm({ folders }: { folders: Opt[] }) {
  return (
    <ActionForm action={createDocument} label="New document" submitLabel="Add document" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="do-title" label="Title" error={e.title}><Input id="do-title" name="title" required /></Field>
          <Field id="do-folder" label="Folder" error={e.folderId}>
            <Select id="do-folder" name="folderId" required>{folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select>
          </Field>
          <Field id="do-kind" label="Kind" error={e.kind}>
            <Select id="do-kind" name="kind" defaultValue="document">
              <option value="document">Document</option>
              <option value="sog">SOG</option>
              <option value="policy">Policy</option>
            </Select>
          </Field>
          <Field id="do-number" label="Number (optional)" hint="For example SOG 3.4." error={e.number}><Input id="do-number" name="number" /></Field>
          <label className="flex min-h-11 items-center gap-2 sm:col-span-2">
            <input type="checkbox" name="requiresAck" /> Members must acknowledge reading it
          </label>
        </div>
      )}
    </ActionForm>
  );
}

export function UploadVersionForm({ documentId }: { documentId: string }) {
  return (
    <ActionForm action={uploadVersion.bind(null, documentId)} label="Upload new version" submitLabel="Upload as draft" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="uv-file" label="File" hint="PDF, Word or an image, up to 25 MB" error={e.file}>
            <input id="uv-file" name="file" type="file" className="block w-full text-sm" />
          </Field>
          <Field id="uv-label" label="Version label" hint="For example 2.0" error={e.label}><Input id="uv-label" name="label" required /></Field>
          <div className="sm:col-span-2">
            <Field id="uv-note" label="What changed (optional)" error={e.changeNote}><Input id="uv-note" name="changeNote" /></Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function PublishForm({ versionId, label, canBackdate }: { versionId: string; label: string; canBackdate: boolean }) {
  return (
    <ActionForm action={publishVersion} label={`Publish version ${label}`} submitLabel={`Publish ${label}`} className="space-y-3">
      {(e) => (
        <>
          <input type="hidden" name="versionId" value={versionId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`pv-eff-${versionId}`} label="Effective from (optional)" hint="Blank means today." error={e.effectiveFrom}>
              <Input id={`pv-eff-${versionId}`} name="effectiveFrom" type="date" />
            </Field>
            {canBackdate && (
              <Field id={`pv-why-${versionId}`} label="Reason for an earlier date" error={e.backdateReason}><Input id={`pv-why-${versionId}`} name="backdateReason" /></Field>
            )}
          </div>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="major" /> Major revision — members must read it again
          </label>
        </>
      )}
    </ActionForm>
  );
}

export function ArchiveForm({ documentId, title }: { documentId: string; title: string }) {
  return (
    <ActionForm action={archiveDocument.bind(null, documentId)} label={`Archive ${title}`} submitLabel="Archive document" submitVariant="secondary">
      {(e) => <Field id="ar-why" label="Why is it archived?" error={e.reason}><Input id="ar-why" name="reason" required /></Field>}
    </ActionForm>
  );
}
