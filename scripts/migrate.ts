import fs from "fs";
import path from "path";
import { sys, pool } from "../lib/db";

async function main() {
  await sys(async (c) => {
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
    const dir = path.join(process.cwd(), "db", "migrations");
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const done = await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [f]);
      if (done.rowCount) continue;
      console.log("applying", f);
      await c.query("BEGIN");
      try { await c.query(fs.readFileSync(path.join(dir, f), "utf8")); await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]); await c.query("COMMIT"); }
      catch (e) { await c.query("ROLLBACK"); throw e; }
    }
  });
  await pool.end();
  console.log("migrations up to date");
}
main().catch((e) => { console.error(e); process.exit(1); });
