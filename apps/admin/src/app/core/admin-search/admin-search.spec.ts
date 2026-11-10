import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { IMenu } from '@data-access/interfaces/menu.interface';
import { menu } from '@shared/data/menu';

import {
	AdminSearchEntry,
	QUICK_LINKS,
	SECTIONS,
	canOpen,
	distance,
	entryForUrl,
	indexEntry,
	menuTitleKey,
	searchAdmin,
	searchEntries,
	words,
} from './admin-search';

const language = (name: string): Record<string, string> =>
	JSON.parse(readFileSync(resolve(__dirname, `../../../../public/assets/i18n/${name}.json`), 'utf8'));
const en = language('en');
const bn = language('bn');

const entries = searchEntries(menu);
const indexFor = (strings: Record<string, string>, list: AdminSearchEntry[] = entries) =>
	list.map((entry) => indexEntry(entry, (key) => strings[key] ?? key));
const ids = (query: string, strings = en) => searchAdmin(indexFor(strings), query).entries.map((entry) => entry.id);

/** Every menu row that opens a page. */
function menuPages(items: IMenu[]): IMenu[] {
	return items.flatMap((item) => [...(item.path ? [item] : []), ...menuPages(item.children ?? [])]);
}

describe('the admin search list', () => {
	it('has an entry for every page in the menu, so a new page cannot be left out', () => {
		const paths = new Set(entries.map((entry) => entry.path));
		for (const page of menuPages(menu)) expect(paths, page.path).toContain(page.path);
	});

	it('names and describes every entry in English and Bengali', () => {
		for (const entry of entries) {
			for (const key of [entry.titleKey, ...entry.trailKeys, `search_hint_${entry.id}`]) {
				expect(en[key], `en ${key}`).toBeTruthy();
				expect(bn[key], `bn ${key}`).toBeTruthy();
			}
		}
		for (const key of ['search_home', 'search_group_pages', 'search_group_recent', 'search_group_go_to']) {
			expect(en[key] && bn[key], key).toBeTruthy();
		}
	});

	it('keeps ids unique, and the quick links point at real entries', () => {
		const all = entries.map((entry) => entry.id);
		expect(new Set(all).size).toBe(all.length);
		for (const id of QUICK_LINKS) expect(all).toContain(id);
	});

	it('reads menu titles the way the sidebar does', () => {
		expect(menuTitleKey('add user')).toBe('add_user');
		expect(menuTitleKey('add-on templates')).toBe('add-on_templates');
	});

	it('gives children their parent’s icon, path and permissions', () => {
		const create = entries.find((entry) => entry.id === 'product_create');
		expect(create).toMatchObject({
			icon: 'ri-store-3-line',
			trailKeys: ['products'],
			permissions: ['product.create'],
		});
		const qna = entries.find((entry) => entry.id === 'qna');
		expect(qna?.permissions).toEqual(['product.index', 'product.create', 'attribute.index']);
	});
});

describe('searching', () => {
	it('puts the Sharing tab first for "share", then the Brand Kit section', () => {
		expect(ids('share').slice(0, 2)).toEqual(['storefront_setting_share', 'setting_brand_sharing']);
	});

	it('finds a place by a common word for it', () => {
		expect(ids('via')[0]).toBe('storefront_setting_share');
		expect(ids('gst')[0]).toBe('tax');
		expect(ids('whatsapp')).toContain('setting_notifications');
	});

	it('reads a close spelling and says so', () => {
		const outcome = searchAdmin(indexFor(en), 'favicn');
		expect(outcome.corrected).toEqual({ typed: 'favicn', used: 'favicon' });
		expect(outcome.entries[0]?.id).toBe('setting_brand_seal');
	});

	it('needs every word to match, and finds nothing for nonsense', () => {
		expect(ids('brand colour')[0]).toBe('setting_brand_colour');
		expect(searchAdmin(indexFor(en), 'xyzq')).toEqual({ entries: [], corrected: null });
		expect(searchAdmin(indexFor(en), '   ')).toEqual({ entries: [], corrected: null });
	});

	it('finds pages by their Bengali names, and by English words while Bengali is shown', () => {
		expect(ids('অর্ডার', bn)).toContain('order');
		expect(ids('ব্র্যান্ড', bn)).toContain('setting_brand');
		expect(ids('orders', bn)).toContain('order');
	});

	it('splits Bengali words without breaking their vowel signs', () => {
		expect(words('সব অর্ডার')).toEqual(['সব', 'অর্ডার']);
	});

	it('measures spelling distance and gives up early', () => {
		expect(distance('favicn', 'favicon')).toBe(1);
		expect(distance('orders', 'order')).toBe(1);
		expect(distance('abc', 'xyzabc', 1)).toBe(2);
		expect(distance('kitten', 'sitting', 1)).toBe(2);
	});
});

describe('who sees what', () => {
	it('lists only places the operator can open, like the menu', () => {
		const tax = entries.find((entry) => entry.id === 'tax');
		const dashboard = entries.find((entry) => entry.id === 'dashboard');
		expect(tax && canOpen(tax, ['tax.index'])).toBe(true);
		expect(tax && canOpen(tax, ['order.index'])).toBe(false);
		expect(dashboard && canOpen(dashboard, [])).toBe(true);
		const visible = entries.filter((entry) => canOpen(entry, ['order.index']));
		expect(searchAdmin(indexFor(en, visible), 'tax').entries).toEqual([]);
	});
});

describe('the entry for an address', () => {
	it('picks the tab or section the address names, else the page', () => {
		expect(entryForUrl(entries, '/storefront-setting?tab=share')?.id).toBe('storefront_setting_share');
		expect(entryForUrl(entries, '/storefront-setting')?.id).toBe('storefront_setting');
		expect(entryForUrl(entries, '/setting/brand#brand_sharing')?.id).toBe('setting_brand_sharing');
		expect(entryForUrl(entries, '/setting/brand/')?.id).toBe('setting_brand');
		expect(entryForUrl(entries, '/nowhere')).toBeUndefined();
	});

	it('every section lands on a page that is itself in the menu', () => {
		const pages = new Set(menuPages(menu).map((page) => page.path));
		for (const section of SECTIONS) expect(pages, section.id).toContain(section.path);
	});
});
