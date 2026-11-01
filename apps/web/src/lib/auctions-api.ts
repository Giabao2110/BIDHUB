import { apiRequest, apiWrite } from "./api-client";
import type {
  AuctionDetailDto,
  Category,
  DraftInput,
  PageResult,
} from "./models";
import type { AuctionSnapshot } from "@bidhub/contracts";

export const auctionsApi = {
  categories: (signal: AbortSignal) =>
    apiRequest<{ items: Category[] }>("/categories", { signal }),
  list: (params: URLSearchParams, signal: AbortSignal) =>
    apiRequest<PageResult<AuctionDetailDto>>(`/auctions?${params}`, { signal }),
  detail: (id: string, signal: AbortSignal) =>
    apiRequest<AuctionDetailDto>(`/auctions/${encodeURIComponent(id)}`, {
      signal,
    }),
  mine: (page: number, signal: AbortSignal) =>
    apiRequest<PageResult<AuctionDetailDto>>(
      `/me/auctions?page=${page}&pageSize=20`,
      { signal, cache: "no-store" },
    ),
  save: (input: DraftInput, id?: string) =>
    apiWrite<{ auction: AuctionSnapshot }>(
      id ? `/auctions/${encodeURIComponent(id)}` : "/auctions",
      id ? "PATCH" : "POST",
      input,
    ),
  publish: (id: string) =>
    apiWrite<{ auction: AuctionSnapshot }>(
      `/auctions/${encodeURIComponent(id)}/publish`,
      "POST",
    ),
  remove: (id: string) =>
    apiWrite<void>(`/auctions/${encodeURIComponent(id)}`, "DELETE"),
};
