import postgres from 'postgres';

export const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function createSql(url: string = process.env.SOMA_DB_URL ?? DEFAULT_DB_URL): postgres.Sql {
  return postgres(url, { max: 4, onnotice: () => undefined });
}
