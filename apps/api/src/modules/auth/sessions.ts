import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { withTransaction } from '../../realtime/after-commit.js';

const validToken = /^[A-Za-z0-9_-]{43}$/;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: 'MEMBER' | 'ADMIN';
}

/** Caller chooses expiry; cookie/lifetime policy belongs to the HTTP auth slice. */
export async function createSession(db: Pool, userId: string, expiresAt: Date): Promise<{ token: string; expiresAt: Date } | null> {
  if (!Number.isFinite(expiresAt.getTime())) throw new RangeError('Invalid session expiry.');
  const token = randomBytes(32).toString('base64url');
  return withTransaction(db, async client => {
    // Disable must update/lock this same user before revoking its sessions.
    const user = await client.query('SELECT id FROM users WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [userId]);
    if (!user.rowCount) return null;
    const result = await client.query(`INSERT INTO sessions(user_id,token_hash,expires_at)
      SELECT $1,$2,$3::timestamptz WHERE $3::timestamptz > clock_timestamp()
      RETURNING expires_at`, [userId, tokenHash(token), expiresAt]);
    if (!result.rowCount) throw new RangeError('Session expiry must be in the future.');
    return { token, expiresAt: result.rows[0].expires_at as Date };
  });
}

/** Resolves current DB identity/role on every request; never returns token hashes. */
export async function findSessionUser(db: Pool, token: string): Promise<SessionUser | null> {
  if (!validToken.test(token)) return null;
  const result = await db.query(`SELECT u.id,u.email,u.display_name AS "displayName",u.role
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at > clock_timestamp() AND u.disabled_at IS NULL`, [tokenHash(token)]);
  return result.rows[0] ?? null;
}

export async function revokeSession(db: Pool, token: string): Promise<void> {
  if (!validToken.test(token)) return;
  await db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
}

/** Disable callers must hold the user row lock on their transaction client. */
export async function revokeUserSessions(db: Pick<Pool, 'query'>, userId: string): Promise<number> {
  const result = await db.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  return result.rowCount ?? 0;
}
