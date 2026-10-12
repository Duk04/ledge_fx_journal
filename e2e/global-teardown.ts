import pg from "pg";
import { e2eBaseUrl, e2eSchema } from "./db-url";

/** Drops the run's scratch schema — and only it. */
export default async function globalTeardown() {
  const schema = e2eSchema();
  if (!/^e2e_[a-z0-9]+$/.test(schema)) throw new Error(`Refusing to drop unexpected schema "${schema}".`);
  const client = new pg.Client({ connectionString: e2eBaseUrl() });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.end();
  }
}
