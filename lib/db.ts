import { Pool, PoolClient, types } from "pg";

// numeric -> number, bigint -> number, date -> 'YYYY-MM-DD' string (no timezone shifts)
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1082, (v) => v);

const g = globalThis as unknown as { __erpPool?: Pool };
export const pool: Pool =
  g.__erpPool ??
  (g.__erpPool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres@localhost:5434/erp",
    max: 10,
  }));

export type Client = PoolClient;

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "COMPANY_ADMIN" | "ACCOUNTANT" | "VIEWER";
  companyIds: number[];
  ip?: string;
}

/** Owner connection (auth, migrations, seed). Never use for user-driven data queries. */
export async function sys<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/**
 * Runs fn inside one transaction as the low-privilege `erp_app` role with row level security bound
 * to the caller's companies. Any error rolls everything back.
 */
export async function tx<T>(user: SessionUser, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE erp_app");
    await c.query("SELECT set_config('app.is_super', $1, true), set_config('app.company_ids', $2, true), set_config('app.user_id', $3, true)", [
      user.role === "SUPER_ADMIN" ? "1" : "0",
      user.companyIds.join(","),
      String(user.id),
    ]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function q<T = any>(c: Client, text: string, params: any[] = []): Promise<T[]> {
  return (await c.query(text, params)).rows as T[];
}
export async function q1<T = any>(c: Client, text: string, params: any[] = []): Promise<T | undefined> {
  return (await c.query(text, params)).rows[0] as T | undefined;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
