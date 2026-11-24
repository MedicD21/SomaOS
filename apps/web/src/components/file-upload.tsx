'use client';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/ui/field';
import { uploadFile } from '@/app/files/actions';

export function FileUpload({ entity, entityId }: { entity: 'member'; entityId: string }) {
  return (
    <ActionForm action={uploadFile.bind(null, entity, entityId)} label="Upload file" submitLabel="Upload" resetOnSuccess>
      <Field id={`upload-${entityId}`} label="File" hint="PDF, image, Word, Excel, CSV or text — up to 25 MB">
        <input id={`upload-${entityId}`} name="file" type="file" className="block w-full text-sm" />
      </Field>
    </ActionForm>
  );
}
