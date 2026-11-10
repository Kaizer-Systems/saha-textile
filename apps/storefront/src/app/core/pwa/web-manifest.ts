import type { Locale } from '@core/i18n/locale';
import type { StorefrontBrand } from '@data-access/queries/brand.queries';

/** Until the Brand Kit answers: matches the top bar, and the `theme-color` tag in `index.html`. */
const THEME_COLOR = '#417394';
const BACKGROUND_COLOR = '#ffffff';
/** Used until a Brand Kit name exists, as the page title does. */
const FALLBACK_NAME = 'Saha Textile';
const ICON_SIZES = ['192', '512'] as const;

export const MANIFEST_PATH = '/manifest.webmanifest';

export const manifestPath = (locale: Locale): string => `${MANIFEST_PATH}?lang=${locale}`;

/**
 * The web app manifest for one language. `id` stays the same in every language, so a browser sees
 * one app. `start_url` names the language outright: `/` would depend on `st_locale`, an optional
 * cookie that a shopper may have refused.
 */
export function webManifest(brand: StorefrontBrand | null, locale: Locale) {
	const name = brand?.shopName || FALLBACK_NAME;
	return {
		id: '/',
		name,
		short_name: name,
		lang: locale,
		dir: 'ltr',
		start_url: `/${locale}/`,
		scope: '/',
		display: 'standalone',
		theme_color: brand?.themeColor || THEME_COLOR,
		background_color: BACKGROUND_COLOR,
		categories: ['shopping'],
		icons: ICON_SIZES.map((size) => ({
			src: brand?.icons[size] ?? `/assets/images/app-icon-${size}.png`,
			sizes: `${size}x${size}`,
			type: 'image/png',
			purpose: 'any',
		})),
	};
}
