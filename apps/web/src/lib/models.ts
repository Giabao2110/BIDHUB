import type { AuctionSnapshot } from "@bidhub/contracts";
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: "MEMBER" | "ADMIN";
}
export interface Category {
  id: string;
  slug: string;
  name: string;
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
/** Frontend adapter proposal for list/my-auctions items; review with backend before release. */
export interface AuctionDetailDto {
  auction: AuctionSnapshot;
  description: string;
  imageUrl: string | null;
  seller: { id: string; displayName: string };
  category: { id: string; name: string };
  startsAt?: string;
  openingPriceVnd?: string;
}
export interface DraftInput {
  title: string;
  description: string;
  categoryId: string;
  imageUrl: string | null;
  openingPriceVnd: string;
  minimumIncrementVnd: string;
  startsAt: string;
  endsAt: string;
}
