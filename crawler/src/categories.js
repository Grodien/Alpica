/**
 * Maps a report's raw activity string (a comma-separated list of source tokens,
 * e.g. "rock_climbing, mountain_climbing") to EXACTLY ONE normalized category.
 *
 * Normalizing at crawl time (instead of at query time) means the DB stores a
 * single `category` per report, so filtering is a simple indexed
 * `category IN (...)` instead of FIND_IN_SET over a token list.
 *
 * When a report carries several activities, the highest-priority category wins
 * (see CATEGORY_PRIORITY). "paragliding" is intentionally last-resort: it only
 * yields the "andere" category when it is the ONLY activity, otherwise the
 * main activity (climbing, mountaineering, hiking, ...) decides.
 *
 * Keep the category keys in sync with web/src/app/filter-options.ts.
 */

/** All category keys, highest priority first. */
export const CATEGORY_PRIORITY = [
  'skitour',
  'freeride',
  'hochtour',
  'schneeschuh',
  'eisklettern',
  'klettersteig',
  'klettertour',
  'bike',
  'canyoning',
  'wanderung',
  'andere',
];

/**
 * Raw-token -> category rules. Tokens come from camptocamp, gipfelbuch,
 * skitour.fr and powderguide. A token matches a category when its regex hits.
 * Note: snow_ice_mixed -> hochtour (C2C "snow/ice" alpine routes, not water-ice
 * climbing), decided from real data.
 */
const TOKEN_RULES = [
  { category: 'skitour',      match: /ski.?tour|skitour/i },
  { category: 'freeride',     match: /freeride/i },
  { category: 'schneeschuh',  match: /snowshoe|schneeschuh|raquette/i },
  { category: 'eisklettern',  match: /ice.?climb|cascade|glace/i },
  { category: 'klettersteig', match: /via.?ferrata|klettersteig/i },
  { category: 'klettertour',  match: /rock.?climb|escalade|klettern/i },
  { category: 'hochtour',     match: /mountain.?climb|alpin|mountaineer|hochtour|snow.?ice/i },
  { category: 'bike',         match: /bike|biking|vtt|velo/i },
  { category: 'canyoning',    match: /canyon/i },
  { category: 'wanderung',    match: /\bhik|rando|wander|\bhike\b/i },
  // paragliding handled specially below (only -> andere when it stands alone).
];

const rank = Object.fromEntries(CATEGORY_PRIORITY.map((c, i) => [c, i]));

/**
 * Returns the single normalized category for a raw activity string, or 'andere'
 * when nothing matches. Null/empty activity also yields 'andere'.
 *
 * @param {string|null} rawActivity
 * @returns {string} one of CATEGORY_PRIORITY
 */
export function categorize(rawActivity) {
  if (!rawActivity || typeof rawActivity !== 'string') return 'andere';

  const tokens = rawActivity
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return 'andere';

  const matched = new Set();
  let sawParagliding = false;
  let sawOther = false;

  for (const token of tokens) {
    if (/paraglid|parapente|gleitschirm/i.test(token)) {
      sawParagliding = true;
      continue;
    }
    const rule = TOKEN_RULES.find((r) => r.match.test(token));
    if (rule) matched.add(rule.category);
    else sawOther = true;
  }

  if (matched.size > 0) {
    // Highest-priority matched category wins.
    return [...matched].sort((a, b) => rank[a] - rank[b])[0];
  }
  // No main category matched: paragliding (or any unknown) -> andere.
  return 'andere';
}
