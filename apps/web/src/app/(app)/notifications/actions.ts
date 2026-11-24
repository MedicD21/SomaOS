'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getRequestContext, withCtxDb } from '@/server/context';

export async function markRead(form: FormData): Promise<void> {
  const id = z.uuid().parse(form.get('id'));
  const ctx = await getRequestContext();
  await withCtxDb(ctx, (tx) => tx`update notifications set read_at = now() where id = ${id} and read_at is null`);
  revalidatePath('/', 'layout');
}

export async function markAllRead(): Promise<void> {
  const ctx = await getRequestContext();
  await withCtxDb(ctx, (tx) => tx`update notifications set read_at = now() where read_at is null`);
  revalidatePath('/', 'layout');
}
