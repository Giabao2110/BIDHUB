import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { HttpProblem } from '../../http/error.js';
import { withTransaction } from '../../realtime/after-commit.js';
import type { PublicAuctionSnapshot } from '../../realtime/publisher.js';
import { auctionUuid } from '../auctions/list-query.js';
import { auctionSnapshot, type SnapshotRow } from '../auctions/snapshot.js';
import type { BrowserSession } from '../auth/browser-session.js';
import type { SessionUser } from '../auth/sessions.js';

type AdminRow = { id: string; role: SessionUser['role']; disabled: boolean };
const forbidden = () => new HttpProblem(403, 'FORBIDDEN', 'Administrator access required');
function entityId(id: unknown) {
  if (typeof id !== 'string' || !auctionUuid.test(id)) throw new HttpProblem(404, 'NOT_FOUND', 'Resource not found');
  return id.toLowerCase();
}
function reasonFrom(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 300 || value.includes('\0')) {
    throw new HttpProblem(422, 'INVALID_INPUT', 'Provide a reason of 1–300 characters');
  }
  return value.trim();
}
function assertAdmin(actor: AdminRow | undefined) {
  if (actor?.role !== 'ADMIN' || actor.disabled) throw forbidden();
}
function audit(client: PoolClient, actor: string, action: string, id: string, details: object) {
  return client.query('INSERT INTO audit_logs(actor_id,action,entity_id,details) VALUES ($1,$2,$3,$4::jsonb)', [actor, action, id, JSON.stringify(details)]);
}

export function adminRouter(db: Pool, browser: BrowserSession, publish: (auction: PublicAuctionSnapshot) => void) {
  const router = Router();
  router.use(browser.requireUser, (_req, res, next) => {
    if ((res.locals.user as SessionUser).role !== 'ADMIN') throw forbidden();
    next();
  });

  router.get('/auctions', async (req, res) => {
    const query = req.query.q;
    if (typeof query !== 'string' || !query.trim() || query.length > 160 || query.includes('\0')) {
      throw new HttpProblem(422, 'INVALID_QUERY', 'Enter an auction title or ID');
    }
    const { rows } = await db.query(`SELECT id,title,status FROM auctions
      WHERE strpos(lower(title),lower($1))>0 OR id::text=lower($1)
      ORDER BY created_at DESC,id LIMIT 21`, [query.trim()]);
    res.json({ items: rows.slice(0, 20), truncated: rows.length > 20 });
  });

  // Keep the exact email out of the URL and proxy access logs.
  router.post('/users/lookup', browser.requireCsrf, async (req, res) => {
    const email = req.body?.email;
    if (typeof email !== 'string' || !email.trim() || email.length > 254 || email.includes('\0')) {
      throw new HttpProblem(422, 'INVALID_QUERY', 'Enter the account email');
    }
    const { rows } = await db.query(`SELECT id,email,display_name AS "displayName",role,disabled_at IS NOT NULL AS disabled
      FROM users WHERE email=$1`, [email.trim().toLowerCase()]);
    res.json({ items: rows });
  });

  router.post('/auctions/:id/cancel', browser.requireCsrf, async (req, res) => {
    const id = entityId(req.params.id);
    const reason = reasonFrom(req.body?.reason);
    const actorId = (res.locals.user as SessionUser).id;
    const auction = await withTransaction(db, async (client, afterCommit) => {
      const { rows: [actor] } = await client.query<AdminRow>('SELECT id,role,disabled_at IS NOT NULL AS disabled FROM users WHERE id=$1 FOR SHARE', [actorId]);
      assertAdmin(actor);
      // Same auction row lock as bids and the close worker.
      const { rows: [previous] } = await client.query<{ status: string }>('SELECT status FROM auctions WHERE id=$1 FOR UPDATE', [id]);
      if (!previous) throw new HttpProblem(404, 'NOT_FOUND', 'Auction not found');
      if (!['DRAFT', 'SCHEDULED', 'ACTIVE'].includes(previous.status)) throw new HttpProblem(409, 'AUCTION_TERMINAL', 'This auction is already terminal');
      const { rows: [updated] } = await client.query<SnapshotRow & { was_published: boolean; server_time: Date }>(`
        UPDATE auctions SET status='CANCELLED', version=version+1, was_published=was_published OR status<>'DRAFT'
        WHERE id=$1 RETURNING id,title,status,current_price_vnd,minimum_increment_vnd,ends_at,version,was_published,clock_timestamp() AS server_time`, [id]);
      if (!updated) throw new Error('Cancelled auction disappeared');
      const snapshot = auctionSnapshot(updated, updated.server_time);
      await audit(client, actorId, 'AUCTION_CANCELLED', id, { reason, fromStatus: previous.status });
      if (updated.was_published) afterCommit(() => publish(snapshot));
      return snapshot;
    });
    res.json({ auction });
  });

  router.patch('/users/:id', browser.requireCsrf, async (req, res) => {
    const id = entityId(req.params.id);
    const actorId = (res.locals.user as SessionUser).id;
    const reason = reasonFrom(req.body?.reason);
    const disabled = req.body?.disabled;
    if (typeof disabled !== 'boolean') throw new HttpProblem(422, 'INVALID_INPUT', 'disabled must be boolean');
    const user = await withTransaction(db, async client => {
      // Serialize account moderation before locking users in ID order so the last
      // active admin remains protected even when two admins disable each other.
      await client.query('SELECT pg_advisory_xact_lock(71286, 15)');
      const { rows } = await client.query<AdminRow>(`SELECT id,role,disabled_at IS NOT NULL AS disabled
        FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE`, [[actorId, id]]);
      assertAdmin(rows.find(row => row.id === actorId));
      const target = rows.find(row => row.id === id);
      if (!target) throw new HttpProblem(404, 'NOT_FOUND', 'Account not found');
      if (target.disabled === disabled) return { id, disabled };
      if (disabled && target.role === 'ADMIN') {
        const { rowCount } = await client.query("SELECT 1 FROM users WHERE role='ADMIN' AND disabled_at IS NULL AND id<>$1 LIMIT 1", [id]);
        if (!rowCount) throw new HttpProblem(409, 'LAST_ADMIN', 'At least one active administrator is required');
      }
      await client.query('UPDATE users SET disabled_at=CASE WHEN $2 THEN clock_timestamp() ELSE NULL END WHERE id=$1', [id, disabled]);
      if (disabled) await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await audit(client, actorId, disabled ? 'USER_DISABLED' : 'USER_ENABLED', id, { reason });
      return { id, disabled };
    });
    res.json({ user });
  });
  return router;
}
