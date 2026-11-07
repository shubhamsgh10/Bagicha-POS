/**
 * Table sections (`tables.section`: inner | outer | vip | terrace | hall | anything an admin typed) as they are
 * PRINTED. Pure. The thermal bill, its plain-text preview twin and the WhatsApp e-bill all print
 * `Table: ${formatTableLabel(...)}` so the three cannot drift; the KOT prints the section on its own line,
 * uppercased (`tableSectionLabel(x)?.toUpperCase()`).
 */
const LABELS: Record<string, string> = {
  inner: "Inner",
  outer: "Outer",
  vip: "VIP",
  terrace: "Terrace",
  hall: "Hall",
};

/** `inner` → "Inner", `vip` → "VIP", `rooftop` → "Rooftop"; blank / null → null. */
export function tableSectionLabel(section: string | null | undefined): string | null {
  const s = (section ?? "").trim();
  if (!s) return null;
  return LABELS[s.toLowerCase()] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Inner - 3"; just "3" when the section is unknown; null when there is no table name. */
export function formatTableLabel(
  tableName: string | null | undefined,
  section: string | null | undefined,
): string | null {
  const name = (tableName ?? "").trim();
  if (!name) return null;
  const label = tableSectionLabel(section);
  return label ? `${label} - ${name}` : name;
}
