import { Router } from 'express';
import type { Pool } from 'pg';
import { HttpProblem } from '../../http/error.js';
import type { BrowserSession } from '../auth/browser-session.js';
import { auctionListQuery, auctionUuid } from './list-query.js';
import { findAuction, listAuctions } from './read.js';

export function auctionsRouter(db: Pool, browser: BrowserSession) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await listAuctions(db, auctionListQuery(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!auctionUuid.test(req.params.id)) throw new HttpProblem(404, 'NOT_FOUND', 'Auction not found');
    const user = await browser.findUser(req);
    const auction = await findAuction(db, req.params.id, user?.id ?? null);
    if (!auction) throw new HttpProblem(404, 'NOT_FOUND', 'Auction not found');
    res.json(auction);
  });

  return router;
}

export function myAuctionsRouter(db: Pool, browser: BrowserSession) {
  const router = Router();
  router.get('/', browser.requireUser, async (req, res) => {
    res.json(await listAuctions(db, auctionListQuery(req.query), res.locals.user.id));
  });
  return router;
}
