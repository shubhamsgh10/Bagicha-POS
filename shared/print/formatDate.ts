export function formatISTDateTime(date: Date | string): { dateStr: string; timeStr: string } {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
  return { dateStr: `${parts.day}/${parts.month}/${parts.year}`, timeStr: `${parts.hour}:${parts.minute}` };
}
