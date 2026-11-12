/**
 * Maps a report's activity string to a display: a category SVG icon URL, a
 * readable label, and a color. Activities differ per source (PowderGuide,
 * Camptocamp, skitour.fr, Gipfelbuch), so we normalize loosely by matching
 * keywords. Falls back to a generic "other" category.
 *
 * Activity colors: Winter #0072bb · Sommer/misc #3b8c47 ·
 * Bergsteigen2 #43526a · Klettern #404040
 *
 * The iconUrl points at the committed category SVGs (single-color), which are
 * recolored to white on the colored map pins / chips via a CSS filter.
 */
interface ActivityDisplay {
  iconUrl: string;
  /** Translation key for the activity label (resolved via I18nService). */
  labelKey: string;
  color: string;
}

const CAT = 'assets/categories';

const RULES: Array<{ match: RegExp } & ActivityDisplay> = [
  { match: /ski.?tour|skitour/i,                 iconUrl: `${CAT}/ski.svg`,         labelKey: 'activity.skitour',        color: '#0072bb' },
  { match: /freeride/i,                           iconUrl: `${CAT}/freeride.svg`,    labelKey: 'activity.freeride',       color: '#0072bb' },
  { match: /snowshoe|schneeschuh|raquette/i,      iconUrl: `${CAT}/schneeschuh.svg`, labelKey: 'activity.snowshoe',       color: '#0072bb' },
  { match: /ice.?climb|cascade|glace/i,           iconUrl: `${CAT}/eis.svg`,         labelKey: 'activity.iceclimb',       color: '#0072bb' },
  { match: /rock.?climb|escalade|klettern/i,      iconUrl: `${CAT}/klettertour.svg`, labelKey: 'activity.climb',          color: '#404040' },
  { match: /via.?ferrata|klettersteig/i,          iconUrl: `${CAT}/klettersteig.svg`, labelKey: 'activity.viaferrata',    color: '#43526a' },
  { match: /mountain.?bike|vtt|bike|velo/i,       iconUrl: `${CAT}/bike.svg`,        labelKey: 'activity.bike',           color: '#3b8c47' },
  { match: /canyon/i,                             iconUrl: `${CAT}/canyoning.svg`,   labelKey: 'activity.canyoning',      color: '#3b8c47' },
  { match: /paraglid|parapente|gleitschirm/i,     iconUrl: `${CAT}/anderes.svg`,     labelKey: 'activity.paraglide',      color: '#3b8c47' },
  { match: /mountain.?climb|alpin|mountaineer|hochtour|snow.?ice/i, iconUrl: `${CAT}/hochtour.svg`, labelKey: 'activity.mountaineering', color: '#43526a' },
  { match: /hik|rando|wander/i,                   iconUrl: `${CAT}/alpwanderung.svg`, labelKey: 'activity.hike',          color: '#3b8c47' },
];

const FALLBACK: ActivityDisplay = {
  iconUrl: `${CAT}/anderes.svg`,
  labelKey: 'activity.fallback',
  color: '#3b8c47',
};

export function activityDisplay(activity: string | null): ActivityDisplay {
  if (!activity) return FALLBACK;
  for (const rule of RULES) {
    if (rule.match.test(activity)) {
      return { iconUrl: rule.iconUrl, labelKey: rule.labelKey, color: rule.color };
    }
  }
  return FALLBACK;
}
