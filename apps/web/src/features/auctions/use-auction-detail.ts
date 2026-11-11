import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuctionSnapshot, AuctionUpdated } from "@bidhub/contracts";
import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { ApiRequestError } from "../../lib/api-client";
import { auctionsApi } from "../../lib/auctions-api";
import type { AuctionDetailDto } from "../../lib/models";

const refreshInterval = 15_000;
type Connection = "connecting" | "joined" | "polling";
type DetailReading = { item: AuctionDetailDto; receivedAt: number };

function inaccessible(error: unknown) {
  return (
    error instanceof ApiRequestError && [401, 403, 404].includes(error.status)
  );
}

function mergeReading(previous: unknown, incoming: unknown): DetailReading {
  const current = previous as DetailReading | undefined;
  const next = incoming as DetailReading;
  if (!current) return next;

  const snapshot = current.item.auction;
  const update = next.item.auction;
  if (update.version < snapshot.version) return current;
  if (update.version > snapshot.version) return next;

  // Equal versions can refresh the countdown clock without changing auction state.
  const newerClock =
    Date.parse(update.serverTime) > Date.parse(snapshot.serverTime);
  return {
    item: {
      ...next.item,
      auction: newerClock
        ? { ...snapshot, serverTime: update.serverTime }
        : snapshot,
    },
    receivedAt: newerClock ? next.receivedAt : current.receivedAt,
  };
}

function usableUpdate(
  auction: AuctionSnapshot | undefined,
  roomId: string,
): auction is AuctionSnapshot {
  return (
    auction?.id === roomId &&
    Number.isSafeInteger(auction.version) &&
    typeof auction.title === "string" &&
    ["DRAFT", "SCHEDULED", "ACTIVE", "ENDED", "CANCELLED"].includes(
      auction.status,
    ) &&
    typeof auction.currentPriceVnd === "string" &&
    /^\d+$/.test(auction.currentPriceVnd) &&
    typeof auction.minimumIncrementVnd === "string" &&
    /^\d+$/.test(auction.minimumIncrementVnd) &&
    Number.isFinite(Date.parse(auction.endsAt)) &&
    Number.isFinite(Date.parse(auction.serverTime))
  );
}

export function useAuctionDetail(id: string, userId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["auction", userId, id] as const,
    [id, userId],
  );
  const [connection, setConnection] = useState<Connection>("connecting");
  const detail = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<DetailReading> => ({
      item: await auctionsApi.detail(id, signal),
      receivedAt: Date.now(),
    }),
    // Both REST and socket writes pass through this comparison at cache commit.
    structuralSharing: mergeReading,
    refetchInterval: (query) => {
      if (inaccessible(query.state.error)) return false;
      return connection === "joined" && !query.state.error
        ? false
        : refreshInterval;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const { refetch } = detail;
  const denied = inaccessible(detail.error);
  const auction = detail.data?.item.auction;
  const roomId =
    denied || auction?.status === "DRAFT" ? undefined : auction?.id;

  useEffect(() => {
    setConnection("connecting");
    if (!roomId) return;

    // The API handshake checks Origin. Browsers send it on a WebSocket upgrade.
    const socket = io({
      autoConnect: false,
      transports: ["websocket"],
      timeout: 5000,
    });
    const room = { auctionId: roomId };
    let generation = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const join = async () => {
      const attempt = ++generation;
      setConnection("connecting");
      const ack = await socket
        .timeout(5000)
        .emitWithAck("auction:join", room)
        .catch(() => null);
      if (attempt !== generation) return;
      if (ack?.ok !== true) {
        setConnection("polling");
        retry = setTimeout(() => void join(), refreshInterval);
        return;
      }

      // Replace any pre-join poll so this request covers the gap before the ACK.
      await refetch({ cancelRefetch: true });
      if (attempt === generation) setConnection("joined");
    };
    const connect = () => void join();
    const disconnected = () => {
      ++generation;
      clearTimeout(retry);
      setConnection("polling");
      if (!socket.active)
        retry = setTimeout(() => socket.connect(), refreshInterval);
    };
    const updated = (event: AuctionUpdated) => {
      const incoming = event?.auction;
      const state = queryClient.getQueryState<DetailReading>(queryKey);
      if (
        !state?.data ||
        inaccessible(state.error) ||
        !usableUpdate(incoming, roomId)
      )
        return;
      if (incoming.version <= state.data.item.auction.version) return;
      queryClient.setQueryData<DetailReading>(queryKey, {
        item: { ...state.data.item, auction: incoming },
        receivedAt: Date.now(),
      });
    };

    socket.on("connect", connect);
    socket.on("connect_error", disconnected);
    socket.on("disconnect", disconnected);
    socket.on("auction:updated", updated);
    socket.connect();
    return () => {
      ++generation;
      clearTimeout(retry);
      socket.off("connect", connect);
      socket.off("connect_error", disconnected);
      socket.off("disconnect", disconnected);
      socket.off("auction:updated", updated);
      if (socket.connected) socket.emit("auction:leave", room);
      socket.disconnect();
    };
  }, [queryClient, queryKey, refetch, roomId]);

  const liveStatus = !roomId
    ? null
    : detail.isError
      ? "Unable to refresh auction details. Retrying every 15 seconds."
      : connection === "joined"
        ? "Live updates connected."
        : connection === "polling"
          ? "Live updates unavailable. Refreshing every 15 seconds."
          : "Connecting live updates…";
  return { detail, denied, liveStatus };
}
