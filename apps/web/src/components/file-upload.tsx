'use client';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/ui/field';
import { uploadFile, type AttachmentEntity } from '@/app/files/actions';

export function FileUpload({ entity, entityId, label = 'Upload file', fieldLabel = 'File' }: {
  entity: AttachmentEntity;
  entityId: string;
  label?: string;
  fieldLabel?: string;
}) {
  return (
    <ActionForm action={uploadFile.bind(null, entity, entityId)} label={label} submitLabel="Upload" resetOnSuccess>
      <Field id={`upload-${entityId}`} label={fieldLabel} hint="PDF, image, Word, Excel, CSV or text — up to 25 MB">
        <input id={`upload-${entityId}`} name="file" type="file" className="block w-full text-sm" />
      </Field>
    </ActionForm>
  );
}
