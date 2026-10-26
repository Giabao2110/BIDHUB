import type { AuctionSnapshot } from "@bidhub/contracts";
/** UI-only fields are proposals, not additions to the agreed shared contract. */
export interface PreviewAuction {
  auction: AuctionSnapshot;
  description: string;
  imageUrl: null;
  seller: { id: string; displayName: string };
  category: { id: string; name: string };
  preview: {
    artwork: "camera" | "headphones" | "watch" | "chair" | "turntable";
    openingPriceVnd: string;
    bidCount: number;
    receivedAt: number;
  };
}
const anchor = Date.now();
export const previewCategories = ["Cameras", "Audio", "Watches", "Interiors"];
const rows = [
  ["Fujifilm X100V camera", "ACTIVE", "18500000", "500000", 0, "camera", 12, 4],
  [
    "Beoplay H95 headphones",
    "ACTIVE",
    "8200000",
    "200000",
    1,
    "headphones",
    8,
    7,
  ],
  ["Seiko Presage watch", "ACTIVE", "4500000", "100000", 2, "watch", 0, 2],
  ["Oak lounge chair", "SCHEDULED", "2400000", "100000", 3, "chair", 0, 48],
  ["Vintage turntable", "ENDED", "3600000", "100000", 1, "turntable", 6, -2],
  ["Classic film camera", "CANCELLED", "1200000", "100000", 0, "camera", 2, -1],
  [
    "Studio headphones · draft",
    "DRAFT",
    "1500000",
    "100000",
    1,
    "headphones",
    0,
    24,
  ],
] as const;
export const auctionFixtures: PreviewAuction[] = rows.map(
  (
    [title, status, price, increment, categoryIndex, artwork, bidCount, hours],
    index,
  ) => ({
    auction: {
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title,
      status,
      currentPriceVnd: price,
      minimumIncrementVnd: increment,
      endsAt: new Date(anchor + hours * 3_600_000).toISOString(),
      serverTime: new Date(anchor).toISOString(),
      version: bidCount,
    },
    description:
      "A sample listing for the BIDHUB preview. Sellers will provide condition, accessories, and delivery details once live data is connected. The illustration is a layout placeholder.",
    imageUrl: null,
    seller: {
      id: "20000000-0000-4000-8000-000000000001",
      displayName: "Sample seller",
    },
    category: {
      id: `30000000-0000-4000-8000-${String(categoryIndex + 1).padStart(12, "0")}`,
      name: previewCategories[categoryIndex]!,
    },
    preview: {
      artwork,
      openingPriceVnd: (
        BigInt(price) -
        BigInt(increment) * BigInt(Math.max(0, bidCount - 1))
      ).toString(),
      bidCount,
      receivedAt: anchor,
    },
  }),
);
export async function readPreviewAuctions(
  signal: AbortSignal,
  fail = false,
): Promise<PreviewAuction[]> {
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 350);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  if (fail)
    throw new Error("Simulated connection error. Live data is not connected.");
  const receivedAt = Date.now();
  return auctionFixtures.map((item) => ({
    ...item,
    preview: { ...item.preview, receivedAt },
    auction: {
      ...item.auction,
      serverTime: new Date(receivedAt).toISOString(),
    },
  }));
}
