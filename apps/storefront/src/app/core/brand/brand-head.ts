import type { ThemeMode } from './theme-mode';
import type { StorefrontBrand } from '@data-access/queries/brand.queries';

const LARGEST_ICON = '512';

function link(page: Document, rel: string, media?: string): HTMLLinkElement {
	const selector = media ? `link[rel="${rel}"][media="${media}"]` : `link[rel="${rel}"]:not([media])`;
	const found = page.head.querySelector<HTMLLinkElement>(selector);
	if (found) return found;
	const created = page.createElement('link');
	created.rel = rel;
	if (media) created.media = media;
	page.head.appendChild(created);
	return created;
}

/** A browser in dark mode picks this tab icon instead (Chrome, Edge and Firefox; Safari ignores it). */
const DARK_BROWSER = '(prefers-color-scheme: dark)';

/** The name under an iPhone's home screen icon. Other platforms read it from the manifest. */
function appTitle(page: Document, name: string): void {
	const found = page.head.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
	const meta = found ?? page.createElement('meta');
	meta.name = 'apple-mobile-web-app-title';
	meta.content = name;
	if (!found) page.head.appendChild(meta);
}

/**
 * The tab icons (and the dark-browser one), home screen icon, browser bar colour and Google's
 * organization card with the shop's own profiles, all from the Brand Kit. With `mode` set (the
 * shopper's switch, or a dark site mode) the tab icon follows the shop instead of the browser.
 */
export function applyBrandHead(
	page: Document,
	brand: StorefrontBrand,
	origin: string,
	mode: ThemeMode | null = null,
): void {
	const darkIcon = brand.iconsDark?.['32'];
	const tabIcon = mode === 'dark' && darkIcon ? darkIcon : brand.icons['32'];
	if (tabIcon) {
		const icon = link(page, 'icon');
		icon.type = 'image/png';
		icon.href = tabIcon;
	}
	const darkLink = page.head.querySelector<HTMLLinkElement>(`link[rel="icon"][media="${DARK_BROWSER}"]`);
	if (darkIcon && !mode) {
		const icon = link(page, 'icon', DARK_BROWSER);
		icon.type = 'image/png';
		icon.href = darkIcon;
	} else darkLink?.remove();
	if (brand.themeColor) {
		const bar = page.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]') ?? page.createElement('meta');
		bar.name = 'theme-color';
		bar.content = brand.themeColor;
		if (!bar.isConnected) page.head.appendChild(bar);
	}
	const homeIcon = brand.icons['180'];
	if (homeIcon) link(page, 'apple-touch-icon').href = homeIcon;
	if (!brand.shopName) return;
	appTitle(page, brand.shopName);
	// The shop's name on every link preview (WhatsApp, Facebook, Telegram show it above the title).
	const siteName =
		page.head.querySelector<HTMLMetaElement>('meta[property="og:site_name"]') ?? page.createElement('meta');
	siteName.setAttribute('property', 'og:site_name');
	siteName.content = brand.shopName;
	if (!siteName.isConnected) page.head.appendChild(siteName);

	// The shop's own profiles, so Google can tie them to the shop.
	const profiles = Object.values(brand.socials ?? {}).filter((address) => address.startsWith('https://'));
	const id = 'brand-organization';
	const script = page.getElementById(id) ?? page.createElement('script');
	script.id = id;
	script.setAttribute('type', 'application/ld+json');
	script.textContent = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'Organization',
		name: brand.shopName,
		url: origin,
		...(brand.icons[LARGEST_ICON] ? { logo: brand.icons[LARGEST_ICON] } : {}),
		...(profiles.length ? { sameAs: profiles } : {}),
	});
	if (!script.isConnected) page.head.appendChild(script);
}
