import type { Pool } from 'pg';
import { hashPassword } from '../modules/auth/password.js';

const id = (n: number) => `d3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const users = [
  { id: id(1), email: 'admin@demo.bidhub.invalid', name: 'Demo Admin', role: 'ADMIN' },
  { id: id(2), email: 'seller@demo.bidhub.invalid', name: 'Demo Seller', role: 'MEMBER' },
  { id: id(3), email: 'bidder@demo.bidhub.invalid', name: 'Demo Bidder', role: 'MEMBER' },
] as const;
const auctions = [
  { id: id(101), title: 'Demo draft headphones', status: 'DRAFT', start: 1, end: 2, price: '100000', version: 0 },
  { id: id(102), title: 'Demo scheduled keyboard', status: 'SCHEDULED', start: 1, end: 3, price: '100000', version: 1 },
  { id: id(103), title: 'Demo active monitor', status: 'ACTIVE', start: -1, end: 2, price: '110000', version: 2 },
  { id: id(104), title: 'Demo sold speaker', status: 'ENDED', start: -2, end: -1, price: '120000', version: 3 },
  { id: id(105), title: 'Demo cancelled mouse', status: 'CANCELLED', start: -1, end: 2, price: '100000', version: 2 },
  { id: id(106), title: 'Demo unsold webcam', status: 'ENDED', start: -2, end: -1, price: '100000', version: 2 },
] as const;

/** Insert-only development data: reruns preserve credentials and auction history. */
export async function seedDemo(db: Pick<Pool, 'connect'>, password: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
  if (password.length < 16 || password.length > 1024) throw new Error('SEED_DEMO_PASSWORD must contain 16 to 1024 characters.');
  // Hash before acquiring the database lock. Each account gets its own salt.
  const hashes = await Promise.all(users.map(() => hashPassword(password)));
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(481232)');
    const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const at = (hours: number) => new Date(now.getTime() + hours * 3600000);
    for (const [index, user] of users.entries()) {
      await client.query(`INSERT INTO users(id,email,password_hash,display_name,role)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, [user.id, user.email, hashes[index], user.name, user.role]);
      const existing = (await client.query('SELECT email,role FROM users WHERE id=$1', [user.id])).rows[0];
      if (existing.email !== user.email || existing.role !== user.role) throw new Error('Demo user ID conflicts with existing data.');
    }
    await client.query("INSERT INTO categories(id,slug,name) VALUES($1,'demo-electronics','Demo Electronics') ON CONFLICT(id) DO NOTHING", [id(10)]);
    const category = (await client.query('SELECT slug FROM categories WHERE id=$1', [id(10)])).rows[0];
    if (category.slug !== 'demo-electronics') throw new Error('Demo category ID conflicts with existing data.');
    for (const [index, auction] of auctions.entries()) {
      const hasBid = auction.status === 'ACTIVE' || auction.id === id(104);
      const inserted = await client.query(`INSERT INTO auctions(id,seller_id,category_id,title,description,status,
        opening_price_vnd,current_price_vnd,minimum_increment_vnd,starts_at,ends_at,highest_bidder_id,version)
        VALUES($1,$2,$3,$4,'Synthetic demo item; no payment or delivery.',$5,100000,$6,10000,$7,$8,$9,$10)
        ON CONFLICT(id) DO NOTHING RETURNING id`,
      [auction.id, id(2), id(10), auction.title, auction.status, auction.price, at(auction.start), at(auction.end), hasBid ? id(3) : null, auction.version]);
      if (!inserted.rowCount) {
        const existing = (await client.query('SELECT seller_id,category_id FROM auctions WHERE id=$1', [auction.id])).rows[0];
        if (existing.seller_id !== id(2) || existing.category_id !== id(10)) throw new Error('Demo auction ID conflicts with existing data.');
        continue;
      }
      const bidId = id(201 + index);
      if (hasBid) {
        await client.query(`INSERT INTO bids(id,auction_id,bidder_id,amount_vnd,idempotency_key,created_at)
          VALUES($1,$2,$3,$4,$5,$6)`, [bidId, auction.id, id(3), auction.price, id(301 + index), at(auction.id === id(104) ? -1.5 : -0.5)]);
      }
      if (auction.status === 'ENDED') {
        await client.query(`INSERT INTO auction_results(auction_id,winner_id,winning_bid_id,final_price_vnd,closed_at)
          VALUES($1,$2,$3,$4,$5)`, [auction.id, hasBid ? id(3) : null, hasBid ? bidId : null, hasBid ? auction.price : null, new Date(at(auction.end).getTime() + 1000)]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
