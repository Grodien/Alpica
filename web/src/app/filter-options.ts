/**
 * Filter options for the mobile filter bottom-sheet.
 *
 * Each category `key` is the canonical category stored on the report (set at
 * crawl time by crawler/src/categories.js). The sheet sends the selected keys
 * directly as the `categories` query param; the API filters with
 * `category IN (...)`. Keep these keys in sync with CATEGORY_PRIORITY.
 *
 * Colors match the activity palette (see activity-icons.ts / styles.css).
 */
export interface FilterCategory {
  /** Canonical category key (matches the DB `category` column). */
  key: string;
  /** German label shown on the chip. */
  label: string;
  /** Icon asset (under assets/categories). */
  icon: string;
  /** Active-chip background color. */
  color: string;
}

export const FILTER_CATEGORIES: FilterCategory[] = [
  { key: 'skitour',      label: 'Skitour',           icon: 'assets/categories/ski.svg',          color: '#0072bb' },
  { key: 'schneeschuh',  label: 'Schneeschuhtour',   icon: 'assets/categories/schneeschuh.svg',  color: '#0072bb' },
  { key: 'eisklettern',  label: 'Eisklettern',       icon: 'assets/categories/eis.svg',          color: '#0072bb' },
  { key: 'freeride',     label: 'Freeride',          icon: 'assets/categories/freeride.svg',     color: '#0072bb' },
  { key: 'klettertour',  label: 'Klettertour',       icon: 'assets/categories/klettertour.svg',  color: '#404040' },
  { key: 'klettersteig', label: 'Klettersteig',      icon: 'assets/categories/klettersteig.svg', color: '#43526a' },
  { key: 'wanderung',    label: 'Wanderung',         icon: 'assets/categories/alpwanderung.svg', color: '#3b8c47' },
  { key: 'hochtour',     label: 'Hochtour',          icon: 'assets/categories/hochtour.svg',     color: '#43526a' },
  { key: 'bike',         label: 'Bike',              icon: 'assets/categories/bike.svg',         color: '#3b8c47' },
  { key: 'canyoning',    label: 'Canyoning',         icon: 'assets/categories/canyoning.svg',    color: '#168b70' },
  { key: 'andere',       label: 'anderer Routentyp', icon: 'assets/categories/anderes.svg',      color: '#168b70' },
];

export interface FilterSource {
  /** DB `source` value. */
  key: string;
  /** Label shown on the chip. */
  label: string;
}

export const FILTER_SOURCES: FilterSource[] = [
  { key: 'camptocamp',  label: 'Camp2Camp.org' },
  { key: 'gipfelbuch',  label: 'Gipfelbuch.ch' },
  { key: 'powderguide', label: 'powderguide.com' },
  { key: 'skitour',     label: 'skitour.fr' },
];
