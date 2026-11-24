import postgres from 'postgres';

export const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
  onnotice: () => undefined,
});
