import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { HttpError, SessionUser, sys, q, q1 } from "./db";

export const COOKIE = "erp_session";
const SESSION_HOURS = 12;

export const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function validatePassword(pw: string) {
  if (pw.length < 10) throw new HttpError(400, "Password must be at least 10 characters");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, "Password needs upper case, lower case and a number");
}
export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);

async function loadUser(userId: number): Promise<SessionUser | null> {
  return sys(async (c) => {
    const u = await q1(c, "SELECT id,email,name,role,active FROM user_profiles WHERE id=$1", [userId]);
    if (!u || !u.active) return null;
    const ids =
      u.role === "SUPER_ADMIN"
        ? await q(c, "SELECT id FROM companies WHERE active ORDER BY id")
        : await q(c, "SELECT m.company_id AS id FROM company_memberships m JOIN companies co ON co.id=m.company_id WHERE m.user_id=$1 AND co.active ORDER BY 1", [userId]);
    return { id: u.id, email: u.email, name: u.name, role: u.role, companyIds: ids.map((r: any) => r.id) };
  });
}

export async function login(email: string, password: string, ip?: string, ua?: string) {
  return sys(async (c) => {
    const u = await q1(c, "SELECT * FROM user_profiles WHERE lower(email)=lower($1)", [email.trim()]);
    // constant-ish time: always run a bcrypt compare
    const hash = u?.password_hash || "$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
    if (u?.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(429, "Account temporarily locked. Try again later.");
    const ok = await bcrypt.compare(password, hash);
    if (!u || !ok || !u.active) {
      if (u) {
        await c.query(
          "UPDATE user_profiles SET failed_logins=failed_logins+1, locked_until=CASE WHEN failed_logins+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1",
          [u.id]
        );
        await c.query("INSERT INTO audit_logs(user_id,user_email,action,entity_type,entity_id,note,ip) VALUES ($1::int,$2,'login_failed','user',$1::text,'bad password',$3)", [u.id, u.email, ip || null]);
      }
      throw new HttpError(401, "Invalid email or password");
    }
    const token = crypto.randomBytes(32).toString("hex");
    await c.query("INSERT INTO sessions(user_id,token_hash,user_agent,ip,expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)", [u.id, sha(token), ua || null, ip || null, String(SESSION_HOURS)]);
    await c.query("UPDATE user_profiles SET failed_logins=0, locked_until=NULL, last_login=now() WHERE id=$1", [u.id]);
    await c.query("INSERT INTO audit_logs(user_id,user_email,action,entity_type,entity_id,ip) VALUES ($1::int,$2,'login','user',$1::text,$3)", [u.id, u.email, ip || null]);
    return { token, expires: new Date(Date.now() + SESSION_HOURS * 3600e3) };
  });
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const row = await sys((c) =>
    q1(c, "UPDATE sessions SET last_seen=now() WHERE token_hash=$1 AND NOT revoked AND expires_at>now() RETURNING user_id,id", [sha(token)])
  );
  if (!row) return null;
  const u = await loadUser(row.user_id);
  if (!u) return null;
  const h = await headers();
  u.ip = h.get("x-forwarded-for")?.split(",")[0] || undefined;
  (u as any).sessionId = row.id;
  return u;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Not signed in");
  return u;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sys((c) => c.query("UPDATE sessions SET revoked=true WHERE token_hash=$1", [sha(token)]));
}

export async function startReset(email: string) {
  const token = crypto.randomBytes(24).toString("hex");
  await sys(async (c) => {
    const r = await c.query("UPDATE user_profiles SET reset_token_hash=$2, reset_expires=now()+interval '30 minutes' WHERE lower(email)=lower($1) AND active RETURNING id", [email.trim(), sha(token)]);
    if (r.rowCount) {
      // No SMTP credentials are configured in this environment, so the link is written to the server log only.
      console.log(`[password-reset] ${email}: /reset-password?token=${token}`);
    }
  });
  return process.env.NODE_ENV !== "production" ? token : undefined;
}
export async function finishReset(token: string, password: string) {
  validatePassword(password);
  const hash = await hashPassword(password);
  return sys(async (c) => {
    const r = await c.query("UPDATE user_profiles SET password_hash=$2, reset_token_hash=NULL, reset_expires=NULL, failed_logins=0, locked_until=NULL WHERE reset_token_hash=$1 AND reset_expires>now() RETURNING id", [sha(token), hash]);
    if (!r.rowCount) throw new HttpError(400, "Reset link is invalid or has expired");
    await c.query("UPDATE sessions SET revoked=true WHERE user_id=$1", [r.rows[0].id]);
  });
}
