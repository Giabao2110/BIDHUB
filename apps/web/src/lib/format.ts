import type { MoneyVnd } from "@bidhub/contracts";
export function formatMoney(value: MoneyVnd): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
