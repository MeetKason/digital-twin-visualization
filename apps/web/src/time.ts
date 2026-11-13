export function beijingTime(time: string | null | undefined) {
  return time && Number.isFinite(Date.parse(time))
    ? new Date(time)
        .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false })
        .slice(0, 16)
    : "无时次";
}

/** 北京时间产品标题，例如 2026年11月13日17时。 */
export function beijingProductTime(time: string | null | undefined) {
  if (!time || !Number.isFinite(Date.parse(time))) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}年${Number(part("month"))}月${Number(part("day"))}日${Number(part("hour"))}时`;
}
