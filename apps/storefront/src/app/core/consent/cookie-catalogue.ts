/**
 * Every cookie and stored item the shop uses, in one list. The Cookie settings popup draws from
 * it, so what shoppers read cannot drift from what the code does. Adding a tool to an empty
 * category turns its switch on: change `COOKIE_POLICY_VERSION` then, so everyone is asked again.
 */
export const COOKIE_POLICY_VERSION = '2026-11-07';

export type OptionalCategory = 'functional' | 'analytics' | 'targeting' | 'marketing' | 'promotional';

export interface CookieItem {
	name: string;
	/** Translation keys. */
	purpose: string;
	keptFor: string;
}

export const NECESSARY_ITEMS: readonly CookieItem[] = [
	{ name: 'st_access, st_refresh', purpose: 'cookie_item_session', keptFor: 'cookie_kept_session' },
	{ name: 'st_csrf', purpose: 'cookie_item_csrf', keptFor: 'cookie_kept_visit' },
	{ name: 'st_guest, ngrx_cart', purpose: 'cookie_item_cart', keptFor: 'cookie_kept_cart' },
	{ name: 'st_consent', purpose: 'cookie_item_consent', keptFor: 'cookie_kept_year' },
	{ name: 'Google, Facebook', purpose: 'cookie_item_sign_in', keptFor: 'cookie_kept_by_them' },
];

export const FUNCTIONAL_ITEMS: readonly CookieItem[] = [
	{ name: 'st_locale', purpose: 'cookie_item_language', keptFor: 'cookie_kept_year' },
	{ name: 'selectedCurrency', purpose: 'cookie_item_currency', keptFor: 'cookie_kept_cleared' },
	{ name: 'st_recent', purpose: 'cookie_item_recent', keptFor: 'cookie_kept_cleared' },
	{ name: 'st_newsletter', purpose: 'cookie_item_newsletter', keptFor: 'cookie_kept_newsletter' },
	{ name: 'Google Maps', purpose: 'cookie_item_map', keptFor: 'cookie_kept_by_google' },
];

/** Categories with nothing behind them show Not in use, and Accept all leaves them off. */
export const EMPTY_CATEGORIES: readonly OptionalCategory[] = ['analytics', 'targeting', 'marketing', 'promotional'];

/** What a refusal removes. Anything optional stored in the browser belongs here. */
export const OPTIONAL_COOKIES: readonly string[] = ['st_locale', 'st_newsletter'];
export const OPTIONAL_STORAGE: readonly string[] = ['st_recent', 'selectedCurrency'];
