import { expect, test, type Page } from "@playwright/test";
import type { AuctionSnapshot } from "@bidhub/contracts";
import react from "@vitejs/plugin-react";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import {
  auctionRoom,
  registerAuctionRooms,
} from "../../../api/src/realtime/auction-rooms";

// REST and public auction data are test fixtures. Socket.IO uses the real room handlers.
const auctionId = "00000000-0000-4000-8000-000000000001";
const room = auctionRoom(auctionId);
const detailPath = `/auctions/${auctionId}`;
let origin: string;
let vite: ViteDevServer;
let io: Server;
let allowHandshake = true;
let allowRoom = true;
let joins = 0;

test.beforeAll(async () => {
  vite = await createViteServer({
    configFile: false,
    root: resolve(import.meta.dirname, "../.."),
    plugins: [react()],
    server: { middlewareMode: true, hmr: false },
  });
  const server = createServer(vite.middlewares);
  io = new Server(server, {
    allowRequest: (request, reply) =>
      reply(null, allowHandshake && request.headers.origin === origin),
  });
  registerAuctionRooms(io, async (id) => {
    joins++;
    return allowRoom && id === auctionId;
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  origin = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  allowHandshake = true;
  allowRoom = true;
  joins = 0;
});

test.afterAll(async () => {
  await io?.close();
  await vite?.close();
});

function snapshot(
  version: number,
  amount = version * 100_000,
): AuctionSnapshot {
  return {
    id: auctionId,
    title: "Realtime test fixture camera",
    status: "ACTIVE",
    currentPriceVnd: String(amount),
    minimumIncrementVnd: "100000",
    endsAt: new Date(Date.now() + 600_000).toISOString(),
    serverTime: new Date().toISOString(),
    version,
  };
}

async function installRestFixture(
  page: Page,
  detail: () => AuctionSnapshot | Promise<AuctionSnapshot>,
) {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401 }),
  );
  await page.route(`**/api/v1${detailPath}`, async (route) =>
    route.fulfill({
      json: {
        auction: await detail(),
        description: "Realtime test fixture description",
        imageUrl: null,
        category: { id: "fixture-category", name: "Cameras" },
        seller: { id: "fixture-seller", displayName: "Fixture seller" },
      },
    }),
  );
  await page.route("**/api/v1/auctions?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  );
  await page.route("**/api/v1/categories", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
}

const price = (page: Page) => page.locator(".detail-price strong");
const connected = (page: Page) => page.getByText("Live updates connected.");
const polling = (page: Page) =>
  page.getByText("Live updates unavailable. Refreshing every 15 seconds.");

test("room updates win over a late REST response, duplicates and other auctions", async ({
  page,
}) => {
  const heldResponse = Promise.withResolvers<AuctionSnapshot>();
  const joinedRequest = Promise.withResolvers<boolean>();
  await installRestFixture(page, () => {
    if (!joins) return snapshot(1);
    joinedRequest.resolve(io.sockets.adapter.rooms.has(room));
    return heldResponse.promise;
  });
  await page.goto(`${origin}${detailPath}`);
  await expect(price(page)).toHaveText("100,000 VND");
  expect(await joinedRequest.promise).toBe(true);

  const ended = { ...snapshot(3), status: "ENDED" };
  io.to(room).emit("auction:updated", { auction: ended });
  await expect(price(page)).toHaveText("300,000 VND");
  await expect(
    page.getByText("This auction has ended.", { exact: false }),
  ).toBeVisible();

  const socket = io.sockets.sockets.values().next().value!;
  const rejectedUpdates = [
    snapshot(2),
    snapshot(3, 800_000),
    { ...snapshot(4), id: `${auctionId}2` },
  ];
  for (const auction of rejectedUpdates)
    socket.emit("auction:updated", { auction });

  heldResponse.resolve(snapshot(2));
  await expect(connected(page)).toBeVisible();
  await expect(price(page)).toHaveText("300,000 VND");
  await expect(
    page.getByText("This auction has ended.", { exact: false }),
  ).toBeVisible();
});

test("transport loss polls REST, then rejoins and fetches missed state", async ({
  page,
}) => {
  await page.clock.install();
  let restVersion = 1;
  let reads = 0;
  await installRestFixture(page, () => {
    reads++;
    return snapshot(restVersion);
  });
  await page.goto(`${origin}${detailPath}`);
  await expect(connected(page)).toBeVisible();
  const readsBeforeDisconnect = reads;

  allowHandshake = false;
  for (const socket of io.sockets.sockets.values()) socket.conn.close();
  await expect(polling(page)).toBeVisible();
  restVersion = 2;
  await page.clock.runFor(15_000);
  await expect(price(page)).toHaveText("200,000 VND");
  const readsAfterPoll = reads;
  expect(readsAfterPoll).toBeGreaterThan(readsBeforeDisconnect);
  expect(joins).toBe(1);

  restVersion = 3;
  allowHandshake = true;
  await page.clock.runFor(8_000);
  await expect(connected(page)).toBeVisible();
  expect(joins).toBe(2);
  expect(reads).toBeGreaterThan(readsAfterPoll);
  await expect(price(page)).toHaveText("300,000 VND");

  const readsAfterResync = reads;
  await page.clock.runFor(16_000);
  expect(reads).toBe(readsAfterResync);
  await page.getByRole("link", { name: "Explore auctions" }).click();
  await expect.poll(() => io.sockets.sockets.size).toBe(0);
  const readsAfterNavigation = reads;
  await page.clock.runFor(30_000);
  expect(reads).toBe(readsAfterNavigation);
  expect(joins).toBe(2);
});

test("rejected join stays on REST and retries without reloading", async ({
  page,
}) => {
  await page.clock.install();
  allowRoom = false;
  let restVersion = 1;
  await installRestFixture(page, () => snapshot(restVersion));
  await page.goto(`${origin}${detailPath}`);
  await expect(polling(page)).toBeVisible();
  expect(io.sockets.adapter.rooms.has(room)).toBe(false);

  allowRoom = true;
  restVersion = 2;
  await page.clock.runFor(16_000);
  await expect(connected(page)).toBeVisible();
  expect(joins).toBe(2);
  await expect(price(page)).toHaveText("200,000 VND");
});
