import { afterEach, describe, expect, it } from 'vitest';

import { applyBrandHead } from './brand-head';

const brand = {
	shopName: 'Shop',
	logo: null,
	seal: null,
	icons: { '32': 'https://cdn.test/32.png', '180': 'https://cdn.test/180.png', '512': 'https://cdn.test/512.png' },
};

const head = () => document.head;

afterEach(() => {
	head().querySelectorAll('link, script').forEach((node) => node.remove());
});

describe('applyBrandHead', () => {
	it('sets the tab icon, the home screen icon and the organization card', () => {
		applyBrandHead(document, brand, 'https://shop.test/');
		expect(head().querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toBe('https://cdn.test/32.png');
		expect(head().querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href).toBe(
			'https://cdn.test/180.png',
		);
		expect(JSON.parse(document.getElementById('brand-organization')?.textContent ?? '')).toMatchObject({
			'@type': 'Organization',
			name: 'Shop',
			url: 'https://shop.test/',
			logo: 'https://cdn.test/512.png',
		});
	});

	it('reuses what is there on a second run', () => {
		const icon = document.createElement('link');
		icon.rel = 'icon';
		head().appendChild(icon);
		applyBrandHead(document, brand, 'https://shop.test/');
		applyBrandHead(document, brand, 'https://shop.test/');
		expect(head().querySelectorAll('link[rel="icon"]')).toHaveLength(1);
		expect(head().querySelectorAll('#brand-organization')).toHaveLength(1);
	});

	it('leaves the default icon alone with no brand', () => {
		applyBrandHead(document, { ...brand, shopName: '', icons: {} }, 'https://shop.test/');
		expect(head().querySelector('link')).toBeNull();
		expect(document.getElementById('brand-organization')).toBeNull();
	});

	it('leaves the logo out of the card when no seal is set', () => {
		applyBrandHead(document, { ...brand, icons: {} }, 'https://shop.test/');
		expect(JSON.parse(document.getElementById('brand-organization')?.textContent ?? '').logo).toBeUndefined();
	});
});
