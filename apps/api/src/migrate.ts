import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPoolFromEnv, databaseConfigFromEnv, safeDatabaseTarget } from "./database.js";

function migrationDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../infra/db");
}

async function main(): Promise<void> {
  const database = databaseConfigFromEnv(true);
  if (!database) throw new Error("DATABASE_URL is required for migrations");
  const pool = createPoolFromEnv({ max: 1 });
  if (!pool) throw new Error("DATABASE_URL is required for migrations");
  const client = await pool.connect();
  try {
    console.log(`Migrating ${safeDatabaseTarget(database.connectionString)}`);
    await client.query("select pg_advisory_lock(hashtext('frontdeskwise:migrations'))");
    await client.query(`
      create table if not exists fdw_schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(migrationDirectory()))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const sql = await readFile(join(migrationDirectory(), file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "select checksum from fdw_schema_migrations where version = $1",
        [file],
      );

      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Migration checksum changed after application: ${file}`);
        }
        continue;
      }

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into fdw_schema_migrations (version, checksum) values ($1, $2)",
          [file, checksum],
        );
        await client.query("commit");
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    console.log(`FrontDeskWise migrations are up to date (${files.length} files checked).`);
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('frontdeskwise:migrations'))");
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
