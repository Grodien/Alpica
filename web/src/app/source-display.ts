/**
 * Canonical display names for report sources, respecting each site's branding:
 *   camptocamp   -> "camptocamp"   (lowercase, not "Camp2Camp")
 *   gipfelbuch   -> "Gipfelbuch"    (no ".ch")
 *   powderguide  -> "POWDERGUIDE"   (all caps)
 *   skitour      -> "Skitour"       (no ".fr")
 *
 * Used for the result-card source link and the filter source chips. Unknown
 * sources fall back to the raw value.
 */
const SOURCE_NAMES: Record<string, string> = {
  camptocamp: 'camptocamp',
  gipfelbuch: 'Gipfelbuch',
  powderguide: 'POWDERGUIDE',
  skitour: 'Skitour',
};

export function sourceDisplay(source: string | null): string {
  if (!source) return '';
  return SOURCE_NAMES[source.toLowerCase()] ?? source;
}
