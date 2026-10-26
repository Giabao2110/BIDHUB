import type { MoneyVnd } from "@bidhub/contracts";
export function formatMoney(value: MoneyVnd): string {
  return `${new Intl.NumberFormat("en-US").format(BigInt(value))} VND`;
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
