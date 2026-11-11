/**
 * Display names for report sources, using each site's domain name:
 *   camptocamp   -> "camptocamp.org"
 *   gipfelbuch   -> "gipfelbuch.ch"
 *   powderguide  -> "PowderGuide.com"
 *   skitour      -> "skitour.fr"
 *
 * Used for the result-card source link and the filter source chips. Unknown
 * sources fall back to the raw value.
 */
const SOURCE_NAMES: Record<string, string> = {
  camptocamp: 'camptocamp.org',
  gipfelbuch: 'gipfelbuch.ch',
  powderguide: 'PowderGuide.com',
  skitour: 'skitour.fr',
};

export function sourceDisplay(source: string | null): string {
  if (!source) return '';
  return SOURCE_NAMES[source.toLowerCase()] ?? source;
}
