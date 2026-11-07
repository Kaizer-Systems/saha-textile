import type { StorefrontBrand } from '@data-access/queries/brand.queries';

const LARGEST_ICON = '512';

function link(page: Document, rel: string): HTMLLinkElement {
	const found = page.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
	if (found) return found;
	const created = page.createElement('link');
	created.rel = rel;
	page.head.appendChild(created);
	return created;
}

/** The tab icon, home screen icon and Google's organization card, from the Brand Kit. */
export function applyBrandHead(page: Document, brand: StorefrontBrand, origin: string): void {
	const tabIcon = brand.icons['32'];
	if (tabIcon) {
		const icon = link(page, 'icon');
		icon.type = 'image/png';
		icon.href = tabIcon;
	}
	const homeIcon = brand.icons['180'];
	if (homeIcon) link(page, 'apple-touch-icon').href = homeIcon;
	if (!brand.shopName) return;

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
	});
	if (!script.isConnected) page.head.appendChild(script);
}
