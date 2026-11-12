import type { Pool } from 'pg';
import type { AuctionListQuery } from './list-query.js';
import { auctionSnapshot, type SnapshotRow } from './snapshot.js';

// Keep guest REST and room authorization on the same publication rule.
const publicAuction = `(a.status IN ('SCHEDULED', 'ACTIVE', 'ENDED')
  OR (a.status='CANCELLED' AND a.was_published))`;

export async function publicAuctionExists(db: Pool, id: string): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM auctions a WHERE a.id=$1 AND ${publicAuction}`, [id]);
  return result.rowCount === 1;
}

interface DetailRow extends SnapshotRow {
  description: string;
  image_url: string | null;
  seller_id: string;
  seller_name: string;
  category_id: string;
  category_name: string;
  starts_at: Date;
  opening_price_vnd: string;
  server_time: Date;
}

const detailColumns = `a.id, a.title, a.status, a.current_price_vnd, a.minimum_increment_vnd, a.ends_at, a.version,
  a.description, a.image_url, a.seller_id, u.display_name AS seller_name,
  a.category_id, c.name AS category_name, a.starts_at, a.opening_price_vnd,
  statement_timestamp() AS server_time`;

function auctionDetail(row: DetailRow) {
  return {
    auction: auctionSnapshot(row, row.server_time),
    description: row.description,
    imageUrl: row.image_url,
    seller: { id: row.seller_id, displayName: row.seller_name },
    category: { id: row.category_id, name: row.category_name },
    startsAt: row.starts_at.toISOString(),
    openingPriceVnd: row.opening_price_vnd,
  };
}

export async function findAuction(db: Pool, id: string, userId: string | null) {
  const result = await db.query<DetailRow>(`SELECT ${detailColumns}
    FROM auctions a JOIN users u ON u.id=a.seller_id JOIN categories c ON c.id=a.category_id
    WHERE a.id=$1 AND (${publicAuction} OR a.seller_id=$2)`, [id, userId]);
  const row = result.rows[0];
  return row ? auctionDetail(row) : null;
}

export async function listAuctions(db: Pool, filters: AuctionListQuery, sellerId: string | null = null) {
  const { term, categoryId, status, sort, page, pageSize } = filters;
  const order = sort === 'endingSoon' ? 'a.ends_at ASC, a.id ASC' : 'a.created_at DESC, a.id DESC';
  // Keep total and page on the same statement snapshot, including empty pages.
  const result = await db.query<DetailRow & { total: string }>(`WITH filtered AS NOT MATERIALIZED (
      SELECT a.* FROM auctions a
      WHERE (($4::uuid IS NULL AND ${publicAuction}) OR a.seller_id=$4)
        AND ($1::text='' OR strpos(lower(a.title), lower($1))>0 OR strpos(lower(a.description), lower($1))>0)
        AND ($2::uuid IS NULL OR a.category_id=$2)
        AND ($3::text IS NULL OR a.status=$3)
    )
    SELECT totals.total, ${detailColumns}
    FROM (SELECT count(*) AS total FROM filtered) totals
    LEFT JOIN LATERAL (SELECT a.* FROM filtered a ORDER BY ${order} LIMIT $5 OFFSET $6) a ON true
    LEFT JOIN users u ON u.id=a.seller_id LEFT JOIN categories c ON c.id=a.category_id
    ORDER BY ${order}`, [term, categoryId, status, sellerId, pageSize, (page - 1) * pageSize]);
  return {
    items: result.rows.filter(row => row.id !== null).map(auctionDetail),
    total: Number(result.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}
