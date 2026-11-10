// DEV ONLY: drops and recreates the public schema, then you re-run migrate + seed.
import { sys, pool } from "../lib/db";
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to reset a production database");
  await sys(async (c) => { await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"); await c.query("DROP ROLE IF EXISTS erp_app").catch(() => {}); });
  await pool.end();
  console.log("schema reset");
}
main().catch((e) => { console.error(e); process.exit(1); });
