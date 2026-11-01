import type { BrowserContext, Route } from "@playwright/test";
import type { AuctionDetailDto, DraftInput, User } from "../../src/lib/models";

/** In-memory HTTP contract simulator for browser tests. Never imported by application code. */
export function contractFixture() {
  const seller: User = {
    id: "20000000-0000-4000-8000-000000000001",
    email: "seller@example.test",
    displayName: "Test seller",
    role: "MEMBER",
  };
  const buyer: User = {
    id: "20000000-0000-4000-8000-000000000002",
    email: "buyer@example.test",
    displayName: "Test buyer",
    role: "MEMBER",
  };
  const categories = [
    {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Cameras",
      slug: "may-anh",
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      name: "Audio",
      slug: "am-thanh",
    },
  ];
  const records: AuctionDetailDto[] = [];
  const writes: {
    method: string;
    path: string;
    body: Record<string, unknown>;
    csrf?: string;
  }[] = [];
  const state = {
    seller,
    buyer,
    categories,
    records,
    writes,
    listError: 0,
    writeError: 0,
    csrfError: 0,
    loginError: 0,
    expire: false,
    createDelay: 0,
  };
  function record(
    title: string,
    owner = seller,
    status: AuctionDetailDto["auction"]["status"] = "ACTIVE",
  ) {
    const now = Date.now();
    const item: AuctionDetailDto = {
      auction: {
        id: `10000000-0000-4000-8000-${String(records.length + 1).padStart(12, "0")}`,
        title,
        status,
        currentPriceVnd: "1000000",
        minimumIncrementVnd: "100000",
        endsAt: new Date(now + 86_400_000).toISOString(),
        serverTime: new Date(now).toISOString(),
        version: 1,
      },
      description: "Contract-test listing data. This is not a live auction.",
      imageUrl: null,
      seller: { id: owner.id, displayName: owner.displayName },
      category: categories[records.length % categories.length]!,
      startsAt: new Date(now - 60_000).toISOString(),
      openingPriceVnd: "1000000",
    };
    records.push(item);
    return item;
  }
  for (let index = 1; index <= 21; index++)
    record(`Test item ${String(index).padStart(2, "0")}`);
  function page(items: AuctionDetailDto[], url: URL) {
    const current = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const size = 20;
    return {
      items: items.slice((current - 1) * size, current * size).map((item) => ({
        ...item,
        auction: { ...item.auction, serverTime: new Date().toISOString() },
      })),
      page: current,
      pageSize: size,
      total: items.length,
    };
  }
  async function install(context: BrowserContext, initialUser?: User) {
    if (initialUser)
      await context.addCookies([
        {
          name: "test_session",
          value: initialUser.id,
          url: "http://127.0.0.1:5173",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    await context.route("**/api/v1/**", async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api/v1", "");
      const method = request.method();
      const cookie = request.headers().cookie ?? "";
      const user = state.expire
        ? undefined
        : [seller, buyer].find((person) =>
            cookie.includes(`test_session=${person.id}`),
          );
      const body = request.postData()
        ? (request.postDataJSON() as Record<string, unknown>)
        : {};
      const send = (
        json: unknown,
        status = 200,
        headers?: Record<string, string>,
      ) => route.fulfill({ status, json, headers });
      const error = (status: number, code: string) =>
        send(
          {
            error: {
              code,
              message: "Test failure",
              requestId: "test-request-id",
            },
          },
          status,
        );
      if (path === "/auth/me")
        return user ? send({ user }) : error(401, "UNAUTHENTICATED");
      if (path === "/auth/csrf")
        return state.csrfError
          ? error(state.csrfError, "CSRF_INVALID")
          : send({ csrfToken: "contract-test-csrf" });
      if (method !== "GET") {
        writes.push({
          method,
          path,
          body,
          csrf: request.headers()["x-csrf-token"],
        });
        if (request.headers()["x-csrf-token"] !== "contract-test-csrf")
          return error(403, "CSRF_INVALID");
        if (state.writeError)
          return error(
            state.writeError,
            state.writeError === 403 ? "FORBIDDEN" : "STATE_CONFLICT",
          );
      }
      if (path === "/auth/login" || path === "/auth/register") {
        if (state.loginError)
          return error(
            state.loginError,
            state.loginError === 409
              ? "EMAIL_EXISTS"
              : state.loginError === 429
                ? "RATE_LIMITED"
                : "INVALID_CREDENTIALS",
          );
        if (body.password !== "Goodpass123")
          return error(401, "INVALID_CREDENTIALS");
        const person = body.email === buyer.email ? buyer : seller;
        return send({ user: person }, path.endsWith("register") ? 201 : 200, {
          "set-cookie": `test_session=${person.id}; HttpOnly; Path=/; SameSite=Lax`,
        });
      }
      if (path === "/auth/logout")
        return route.fulfill({
          status: 204,
          headers: {
            "set-cookie":
              "test_session=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax",
          },
        });
      if (path === "/categories") return send({ items: categories });
      if (path === "/me/auctions")
        return user
          ? send(
              page(
                records.filter((item) => item.seller.id === user.id),
                url,
              ),
            )
          : error(401, "UNAUTHENTICATED");
      if (path === "/auctions" && method === "GET") {
        if (state.listError) return error(state.listError, "UNAVAILABLE");
        return send(
          page(
            records.filter(
              (item) =>
                item.auction.status !== "DRAFT" &&
                (!url.searchParams.get("query") ||
                  item.auction.title
                    .toLowerCase()
                    .includes(url.searchParams.get("query")!.toLowerCase())) &&
                (!url.searchParams.get("categoryId") ||
                  item.category.id === url.searchParams.get("categoryId")) &&
                (!url.searchParams.get("status") ||
                  item.auction.status === url.searchParams.get("status")),
            ),
            url,
          ),
        );
      }
      if (path === "/auctions" && method === "POST") {
        if (!user) return error(401, "UNAUTHENTICATED");
        if (state.createDelay)
          await new Promise((resolve) =>
            setTimeout(resolve, state.createDelay),
          );
        const input = body as unknown as DraftInput;
        const item = record(input.title, user, "DRAFT");
        item.description = input.description;
        item.imageUrl = input.imageUrl;
        item.category = categories.find(
          (category) => category.id === input.categoryId,
        )!;
        item.openingPriceVnd = input.openingPriceVnd;
        item.startsAt = input.startsAt;
        item.auction.endsAt = input.endsAt;
        item.auction.currentPriceVnd = input.openingPriceVnd;
        item.auction.minimumIncrementVnd = input.minimumIncrementVnd;
        return send({ auction: item.auction }, 201);
      }
      const match = /^\/auctions\/([^/]+)(\/publish)?$/.exec(path);
      if (match) {
        const item = records.find((value) => value.auction.id === match[1]);
        if (!item) return error(404, "NOT_FOUND");
        if (method === "GET")
          return item.auction.status === "DRAFT" && user?.id !== item.seller.id
            ? error(403, "FORBIDDEN")
            : send({
                ...item,
                auction: {
                  ...item.auction,
                  serverTime: new Date().toISOString(),
                },
              });
        if (!user) return error(401, "UNAUTHENTICATED");
        if (user.id !== item.seller.id) return error(403, "FORBIDDEN");
        if (item.auction.status !== "DRAFT")
          return error(409, "STATE_CONFLICT");
        if (match[2]) {
          item.auction.status =
            Date.parse(item.startsAt!) > Date.now() ? "SCHEDULED" : "ACTIVE";
          item.auction.version++;
          return send({ auction: item.auction });
        }
        if (method === "DELETE") {
          records.splice(records.indexOf(item), 1);
          return route.fulfill({ status: 204 });
        }
        if (method === "PATCH") {
          const input = body as unknown as DraftInput;
          item.auction.title = input.title;
          item.description = input.description;
          item.startsAt = input.startsAt;
          item.auction.endsAt = input.endsAt;
          item.openingPriceVnd = input.openingPriceVnd;
          item.auction.currentPriceVnd = input.openingPriceVnd;
          item.auction.minimumIncrementVnd = input.minimumIncrementVnd;
          item.auction.version++;
          return send({ auction: item.auction });
        }
      }
      return error(404, "NOT_FOUND");
    });
  }
  return Object.assign(state, { install, record });
}
