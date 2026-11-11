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
  label: string;
  color: string;
}

const CAT = 'assets/categories';

const RULES: Array<{ match: RegExp } & ActivityDisplay> = [
  { match: /ski.?tour|skitour/i,                 iconUrl: `${CAT}/ski.svg`,         label: 'Skitour',      color: '#0072bb' },
  { match: /freeride/i,                           iconUrl: `${CAT}/freeride.svg`,    label: 'Freeride',     color: '#0072bb' },
  { match: /snowshoe|schneeschuh|raquette/i,      iconUrl: `${CAT}/schneeschuh.svg`, label: 'Schneeschuh',  color: '#0072bb' },
  { match: /ice.?climb|cascade|glace/i,           iconUrl: `${CAT}/eis.svg`,         label: 'Eisklettern',  color: '#0072bb' },
  { match: /rock.?climb|escalade|klettern/i,      iconUrl: `${CAT}/klettertour.svg`, label: 'Klettern',     color: '#404040' },
  { match: /via.?ferrata|klettersteig/i,          iconUrl: `${CAT}/klettersteig.svg`, label: 'Klettersteig', color: '#43526a' },
  { match: /mountain.?bike|vtt|bike|velo/i,       iconUrl: `${CAT}/bike.svg`,        label: 'Bike',         color: '#3b8c47' },
  { match: /canyon/i,                             iconUrl: `${CAT}/canyoning.svg`,   label: 'Canyoning',    color: '#3b8c47' },
  { match: /paraglid|parapente|gleitschirm/i,     iconUrl: `${CAT}/anderes.svg`,     label: 'Gleitschirm',  color: '#3b8c47' },
  { match: /mountain.?climb|alpin|mountaineer|hochtour|snow.?ice/i, iconUrl: `${CAT}/hochtour.svg`, label: 'Hochtour', color: '#43526a' },
  { match: /hik|rando|wander/i,                   iconUrl: `${CAT}/alpwanderung.svg`, label: 'Wanderung',   color: '#3b8c47' },
];

const FALLBACK: ActivityDisplay = {
  iconUrl: `${CAT}/anderes.svg`,
  label: 'Tour',
  color: '#3b8c47',
};

export function activityDisplay(activity: string | null): ActivityDisplay {
  if (!activity) return FALLBACK;
  for (const rule of RULES) {
    if (rule.match.test(activity)) {
      return { iconUrl: rule.iconUrl, label: rule.label, color: rule.color };
    }
  }
  return FALLBACK;
}
