import { Router } from 'express';
import type { Pool } from 'pg';
import { HttpProblem } from '../../http/error.js';
import type { BrowserSession } from '../auth/browser-session.js';
import { auctionListQuery, auctionUuid } from './list-query.js';
import { findAuction, listAuctions } from './read.js';
import { draftBody } from './draft-input.js';
import { createDraft, updateDraft, deleteDraft, publishDraft } from './write.js';

function auctionId(id: unknown) {
  if (typeof id !== 'string' || !auctionUuid.test(id)) throw new HttpProblem(404, 'NOT_FOUND', 'Auction not found');
  return id;
}

export function auctionsRouter(db: Pool, browser: BrowserSession) {
  const router = Router();
  const write = [browser.requireUser, browser.requireCsrf] as const;

  router.get('/', async (req, res) => {
    res.json(await listAuctions(db, auctionListQuery(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = auctionId(req.params.id);
    const user = await browser.findUser(req);
    const auction = await findAuction(db, id, user?.id ?? null);
    if (!auction) throw new HttpProblem(404, 'NOT_FOUND', 'Auction not found');
    res.json(auction);
  });

  router.post('/', ...write, async (req, res) => {
    const auction = await createDraft(db, res.locals.user.id, draftBody(req.body));
    res.status(201).json({ auction });
  });

  router.patch('/:id', ...write, async (req, res) => {
    const auction = await updateDraft(db, res.locals.user.id, auctionId(req.params.id), draftBody(req.body));
    res.json({ auction });
  });

  router.delete('/:id', ...write, async (req, res) => {
    await deleteDraft(db, res.locals.user.id, auctionId(req.params.id));
    res.status(204).end();
  });

  router.post('/:id/publish', ...write, async (req, res) => {
    const auction = await publishDraft(db, res.locals.user.id, auctionId(req.params.id));
    res.json({ auction });
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
