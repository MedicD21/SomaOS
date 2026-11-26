import 'server-only';
import type { Tx } from '@/server/db';

export type Folder = { id: string; parentId: string | null; name: string; viewPermission: string | null };
export type LibraryDoc = {
  id: string;
  folderId: string;
  kind: string;
  title: string;
  number: string | null;
  requiresAck: boolean;
  archived: boolean;
  versionId: string | null;
  label: string | null;
  attachmentId: string | null;
  effectiveFrom: string | null;
};

/** Folders and documents the caller can see (the database hides restricted folders), with the published version of each. */
export async function loadLibrary(tx: Tx): Promise<{ folders: Folder[]; docs: LibraryDoc[] }> {
  const folders = await tx<Folder[]>`
    select id, parent_id as "parentId", name, view_permission as "viewPermission" from document_folders
    where archived_at is null order by lower(name)`;
  const docs = await tx<LibraryDoc[]>`
    select d.id, d.folder_id as "folderId", d.kind, d.title, d.number, d.requires_ack as "requiresAck", d.archived_at is not null as archived,
           v.id as "versionId", v.label, v.attachment_id as "attachmentId", v.effective_from::text as "effectiveFrom"
    from documents d
    left join document_versions v on v.document_id = d.id and v.status = 'published'
    where d.archived_at is null
    order by coalesce(d.number, ''), lower(d.title)`;
  return { folders: [...folders], docs: [...docs] };
}

export type VersionRow = {
  id: string;
  versionNo: number;
  label: string;
  status: 'draft' | 'published' | 'superseded';
  changeNote: string | null;
  effectiveFrom: string | null;
  publishedAt: Date | null;
  major: boolean;
  attachmentId: string;
  fileName: string;
};

export type ReadingRow = {
  id: string;
  versionLabel: string;
  dueOn: string | null;
  closed: boolean;
  assigned: number;
  acknowledged: number;
};

export type DocumentDetail = {
  id: string;
  title: string;
  kind: string;
  number: string | null;
  requiresAck: boolean;
  archived: boolean;
  folder: string;
  versions: VersionRow[];
  readings: ReadingRow[];
};

export async function loadDocument(tx: Tx, id: string): Promise<DocumentDetail | null> {
  const [d] = await tx<{ id: string; title: string; kind: string; number: string | null; requiresAck: boolean; archived: boolean; folder: string }[]>`
    select d.id, d.title, d.kind, d.number, d.requires_ack as "requiresAck", d.archived_at is not null as archived, f.name as folder
    from documents d join document_folders f on f.id = d.folder_id where d.id = ${id}`;
  if (!d) return null;
  const versions = await tx<VersionRow[]>`
    select v.id, v.version_no as "versionNo", v.label, v.status, v.change_note as "changeNote", v.effective_from::text as "effectiveFrom",
           v.published_at as "publishedAt", v.major, v.attachment_id as "attachmentId", a.file_name as "fileName"
    from document_versions v join attachments a on a.id = v.attachment_id
    where v.document_id = ${id} order by v.version_no desc`;
  const readings = await tx<ReadingRow[]>`
    select r.id, v.label as "versionLabel", r.due_on::text as "dueOn", r.closed_at is not null as closed,
           (select count(*)::int from reading_assignees a where a.reading_id = r.id) as assigned,
           (select count(*)::int from acknowledgements k where k.reading_id = r.id) as acknowledged
    from required_readings r join document_versions v on v.id = r.version_id
    where r.document_id = ${id} order by r.created_at desc`;
  return { ...d, versions: [...versions], readings: [...readings] };
}

export type UnitOption = { id: string; name: string };
export type RoleOption = { id: string; label: string };

/** Choices for an assignment audience. */
export async function loadAudienceOptions(tx: Tx): Promise<{ units: UnitOption[]; roles: RoleOption[] }> {
  const units = await tx<UnitOption[]>`select id, name from org_units order by name`;
  const roles = await tx<RoleOption[]>`select id, label from roles order by label`;
  return { units: [...units], roles: [...roles] };
}
