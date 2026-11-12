import pg, { type Pool, type PoolClient } from 'pg';
import { HttpProblem } from '../../http/error.js';
import { withTransaction } from '../../realtime/after-commit.js';
import { validateDraft } from './draft-input.js';
import { auctionSnapshot, type SnapshotRow } from './snapshot.js';

interface DraftRow extends SnapshotRow {
  seller_id: string;
  category_id: string;
  description: string;
  image_url: string | null;
  opening_price_vnd: string;
  starts_at: Date;
}

interface WrittenRow extends SnapshotRow {
  server_time: Date;
}

const returnSnapshot = 'a.id, a.title, a.status, a.current_price_vnd, a.minimum_increment_vnd, a.ends_at, a.version';

async function ownerWrite<T>(db: Pool, sellerId: string, write: (client: PoolClient) => Promise<T>) {
  try {
    return await withTransaction(db, async client => {
      // Match auth's lock order so a disable cannot race an authorized write.
      const user = await client.query('SELECT 1 FROM users WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [sellerId]);
      if (!user.rowCount) throw new HttpProblem(403, 'ACCOUNT_DISABLED', 'Account is disabled');
      return write(client);
    });
  } catch (error) {
    if (error instanceof pg.DatabaseError && error.code === '23503' && error.constraint === 'auctions_category_id_fkey') {
      throw new HttpProblem(422, 'INVALID_CATEGORY', 'Auction category does not exist');
    }
    throw error;
  }
}

async function lockDraft(client: PoolClient, id: string, sellerId: string) {
  const result = await client.query<DraftRow>(`SELECT id, seller_id, category_id, title, description, image_url, status,
    opening_price_vnd, current_price_vnd, minimum_increment_vnd, starts_at, ends_at, version
    FROM auctions WHERE id=$1 FOR UPDATE`, [id]);
  const draft = result.rows[0];
  if (!draft) throw new HttpProblem(404, 'NOT_FOUND', 'Auction not found');
  if (draft.seller_id !== sellerId) throw new HttpProblem(403, 'FORBIDDEN', 'Only the owner may change this auction');
  if (draft.status !== 'DRAFT') throw new HttpProblem(409, 'AUCTION_NOT_DRAFT', 'Only draft auctions may be changed');
  return draft;
}

function draftValues(row: DraftRow) {
  return {
    title: row.title,
    description: row.description,
    categoryId: row.category_id,
    imageUrl: row.image_url,
    openingPriceVnd: row.opening_price_vnd,
    minimumIncrementVnd: row.minimum_increment_vnd,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
  };
}

function writtenSnapshot(row: WrittenRow | undefined) {
  if (!row) throw new Error('Auction write did not return a row');
  return auctionSnapshot(row, row.server_time);
}

export function createDraft(db: Pool, sellerId: string, input: Record<string, unknown>) {
  const draft = validateDraft(input);
  return ownerWrite(db, sellerId, async client => {
    const result = await client.query<WrittenRow>(`INSERT INTO auctions AS a
      (seller_id,category_id,title,description,image_url,opening_price_vnd,current_price_vnd,
        minimum_increment_vnd,starts_at,ends_at)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)
      RETURNING ${returnSnapshot}, statement_timestamp() AS server_time`,
    [sellerId, draft.categoryId, draft.title, draft.description, draft.imageUrl, draft.openingPriceVnd,
      draft.minimumIncrementVnd, draft.startsAt, draft.endsAt]);
    return writtenSnapshot(result.rows[0]);
  });
}

export function updateDraft(db: Pool, sellerId: string, id: string, input: Record<string, unknown>) {
  return ownerWrite(db, sellerId, async client => {
    const current = await lockDraft(client, id, sellerId);
    const draft = validateDraft({ ...draftValues(current), ...input });
    const result = await client.query<WrittenRow>(`UPDATE auctions a
      SET category_id=$2, title=$3, description=$4, image_url=$5,
        opening_price_vnd=$6, current_price_vnd=$6, minimum_increment_vnd=$7,
        starts_at=COALESCE($8,starts_at), ends_at=COALESCE($9,ends_at), version=version+1
      WHERE a.id=$1
      RETURNING ${returnSnapshot}, statement_timestamp() AS server_time`,
    [id, draft.categoryId, draft.title, draft.description, draft.imageUrl, draft.openingPriceVnd,
      draft.minimumIncrementVnd, input.startsAt === undefined ? null : draft.startsAt, input.endsAt === undefined ? null : draft.endsAt]);
    return writtenSnapshot(result.rows[0]);
  });
}

export function deleteDraft(db: Pool, sellerId: string, id: string) {
  return ownerWrite(db, sellerId, async client => {
    await lockDraft(client, id, sellerId);
    await client.query('DELETE FROM auctions WHERE id=$1', [id]);
  });
}

export function publishDraft(db: Pool, sellerId: string, id: string) {
  return ownerWrite(db, sellerId, async client => {
    const current = await lockDraft(client, id, sellerId);
    validateDraft(draftValues(current));
    // This wall clock is evaluated once, after the row lock has been acquired.
    const result = await client.query<WrittenRow>(`WITH publication AS (SELECT clock_timestamp() AS now)
      UPDATE auctions a
      SET status=CASE WHEN a.starts_at > publication.now THEN 'SCHEDULED' ELSE 'ACTIVE' END,
        version=version+1, was_published=true
      FROM publication
      WHERE a.id=$1 AND a.ends_at > publication.now
      RETURNING ${returnSnapshot}, publication.now AS server_time`, [id]);
    if (!result.rowCount) throw new HttpProblem(422, 'INVALID_AUCTION_TIME', 'Auction end must be in the future');
    return writtenSnapshot(result.rows[0]);
  });
}
