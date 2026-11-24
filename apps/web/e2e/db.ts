import postgres from 'postgres';

export const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
  onnotice: () => undefined,
});

/** Creates a confirmed email/password account (local test only). */
export async function createAccount(email: string, password = 'somadev123!'): Promise<string> {
  const [u] = await sql<{ id: string }[]>`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${email},
      extensions.crypt(${password}, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    returning id`;
  await sql`insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
            values (gen_random_uuid(), ${u!.id}, ${u!.id}, 'email', ${sql.json({ sub: u!.id, email, email_verified: true })}, now(), now())`;
  return u!.id;
}
