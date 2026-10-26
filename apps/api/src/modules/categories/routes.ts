import { Router } from 'express';
import type { Pool } from 'pg';

export function categoriesRouter(db: Pick<Pool, 'query'>): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const result = await db.query('SELECT id,slug,name FROM categories ORDER BY slug ASC,id ASC');
    res.json({ items: result.rows });
  });
  return router;
}
