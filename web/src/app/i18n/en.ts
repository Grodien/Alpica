import type { Dict } from './types';

/**
 * English UI strings. Keys mirror de.ts exactly; the I18nService falls back to
 * German for any missing key.
 */
export const en: Dict = {
  // --- Generic / shared ---
  'app.logoAlt': 'MountainRADAR',
  'app.claimAlt': 'One Search. All Conditions.',
  'lang.switch': 'Language',
  'lang.de': 'German',
  'lang.en': 'English',

  // --- Home: search ---
  'home.searchPlaceholder': 'Where are you heading?',
  'home.searchAria': 'Search location',
  'home.searchButtonAria': 'Search',
  'home.clearSearchAria': 'Clear search',
  'home.filterAria': 'Filter',
  'home.loading': 'Loading…',

  // --- Home: date range slider ---
  'home.rangeAria': 'Date range',
  'range.3days': '3 days',
  'range.1week': '1 week',
  'range.1month': '1 month',
  'range.6months': '6 months',
  'range.all': 'All',

  // --- Home: filter dropdowns (desktop) ---
  'home.allCategories': 'All categories',
  'home.allSources': 'All sources',

  // --- Home: map ---
  'home.mapAria': 'Map with results',
  'home.locateAria': 'Show my location',

  // --- Home: results ---
  'home.resultsCount': '{count} results',

  // --- Home: footer ---
  'footer.claim': 'One Search. All Conditions.',
  // Attribution is composed in the template from these parts + a real <a> so
  // the link picks up the component's scoped styles (incl. :visited).
  'footer.attributionPre': 'A service by',
  'footer.attributionMid': ', the makers of',
  'footer.legalNav': 'Legal',
  'footer.impressum': 'Imprint',
  'footer.privacy': 'Privacy',
  'footer.legal': 'Legal notice',

  // --- Dropdown ---
  'dropdown.selectedCount': '{count} selected',
  'dropdown.clearAria': 'Clear selection',

  // --- Filter sheet (mobile) ---
  'filter.title': 'Filter',
  'filter.closeAria': 'Close',
  'filter.activities': 'Activities',
  'filter.sources': 'Sources',
  'filter.reset': 'Reset filters',

  // --- Results list ---
  'result.noTitle': 'Untitled',
  'result.author': 'Author: {name}',
  'result.reportOn': 'Report on {source}',
  'result.emptyViewport': 'No results in the current map view.',
  'result.ageToday': 'Today',
  'result.ageYesterday': 'Yesterday',
  'result.ageDays': '{days} days',

  // --- Activity labels ---
  'activity.skitour': 'Ski tour',
  'activity.freeride': 'Freeride',
  'activity.snowshoe': 'Snowshoe',
  'activity.iceclimb': 'Ice climbing',
  'activity.climb': 'Climbing',
  'activity.viaferrata': 'Via ferrata',
  'activity.bike': 'Bike',
  'activity.canyoning': 'Canyoning',
  'activity.paraglide': 'Paragliding',
  'activity.mountaineering': 'Mountaineering',
  'activity.hike': 'Hiking',
  'activity.fallback': 'Tour',

  // --- Category filter labels ---
  'category.skitour': 'Ski tour',
  'category.schneeschuh': 'Snowshoe tour',
  'category.eisklettern': 'Ice climbing',
  'category.freeride': 'Freeride',
  'category.klettertour': 'Climbing route',
  'category.klettersteig': 'Via ferrata',
  'category.wanderung': 'Hiking',
  'category.hochtour': 'Mountaineering',
  'category.bike': 'Bike',
  'category.canyoning': 'Canyoning',
  'category.andere': 'other route type',

  // --- Shared page-header / back links ---
  'page.backToMap': '← Back to the map',
  'page.toMapAria': 'To the map',

  // --- index.html / document meta (applied at runtime) ---
  'meta.title': 'Mountain-Radar – Current conditions reports from the Alps',
  'meta.description':
    'Mountain-Radar brings together current conditions reports for ski tours, mountaineering, freeride and hiking in the Alps on an interactive map. One Search. All Conditions.',

  // --- Impressum ---
  'impressum.title': 'Imprint',
  'impressum.owner.h': 'Owner',
  'impressum.owner.p': 'Mountain Radar is a service of Bergportal GmbH, based in Sarnen, Switzerland.',
  'impressum.address.h': 'Address',
  'impressum.contact.h': 'Contact',
  'impressum.company.h': 'Company',
  'impressum.company.reps': 'The authorised managing directors are Reto Baur and Philippe Meyenhofer.',
  'impressum.programming.h': 'Development',
  'impressum.contact.via': 'via',
  'impressum.contact.or': 'or via',
  'impressum.company.commercialRegister': 'Commercial register number',
  'impressum.company.uid': 'Business identification number (UID)',
  'impressum.company.vat': 'VAT number',
};
