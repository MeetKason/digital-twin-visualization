export function beijingTime(time: string | null | undefined) {
  return time && Number.isFinite(Date.parse(time))
    ? new Date(time)
        .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false })
        .slice(0, 16)
    : "无时次";
}
