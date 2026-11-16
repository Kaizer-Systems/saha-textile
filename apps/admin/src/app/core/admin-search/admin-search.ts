/**
 * Admin search (owner brief, approved 2026-11-10): find any admin page, tab or Brand Kit section
 * by name, by what it does, or by a common word for it. Everything lives in the browser: the
 * admin has about fifty places, so a list built from the menu is instant and needs no API.
 * Product search stays on Meilisearch.
 *
 * The list is the sidebar menu (`@shared/data/menu`) plus `SECTIONS`, the tabs and sections
 * inside pages. Each entry's one-line hint lives in the language files as `search_hint_<id>`;
 * a spec fails when a menu page has no hint, so a new page cannot be left out.
 */
import { IMenu } from '@data-access/interfaces/menu.interface';

export interface AdminSearchEntry {
	/** Stable id; also the hint's key, `search_hint_<id>`, and what Recently opened stores. */
	id: string;
	path: string;
	queryParams?: Record<string, string>;
	fragment?: string;
	/** Language-file keys: the place's own name, then the menu path above it. */
	titleKey: string;
	trailKeys: string[];
	icon: string;
	/** Extra words people use for the place (English; titles and hints are indexed in both languages). */
	keywords: string[];
	/** Any one of these opens the place; empty means everyone signed in. */
	permissions: string[];
}

/** The language-file key for a menu title, the same way the sidebar reads it. */
export const menuTitleKey = (title: string): string => title.replace(' ', '_');

/** `/setting/brand` becomes `setting_brand`. */
const idFor = (path: string): string => path.replace(/^\//, '').replace(/[/-]/g, '_') || 'home';

/** Common words for menu pages, by entry id. */
const KEYWORDS: Record<string, string[]> = {
	dashboard: ['home', 'overview', 'revenue', 'chart'],
	inbox: ['email', 'mail', 'gmail', 'contact', 'message', 'reply'],
	admin_user_create: ['staff', 'team', 'invite', 'operator'],
	admin_user: ['staff', 'team', 'operator', 'admin'],
	role: ['permission', 'access', 'rights'],
	customer_create: ['client', 'buyer', 'shopper'],
	customer: ['client', 'buyer', 'shopper', 'restore', 'deleted'],
	customer_ledger: ['balance', 'wallet', 'history'],
	product_create: ['new', 'saree', 'item'],
	product: ['saree', 'item', 'stock', 'catalogue', 'catalog'],
	attribute: ['colour', 'color', 'size', 'swatch', 'variant', 'option'],
	measurement: ['size', 'chart', 'blouse'],
	addon_template: ['addon', 'extra', 'fall', 'pico', 'stitching'],
	redirect: ['301', 'old', 'url', 'address', 'link'],
	search_term: ['keyword', 'synonym', 'trending'],
	category: ['collection', 'catalogue'],
	tag: ['label'],
	qna: ['question', 'answer', 'faq'],
	order: ['invoice', 'payment', 'delivery'],
	purchase_orders: ['po', 'order', 'supplier', 'late', 'receive'],
	purchase_entries: ['bill', 'invoice', 'grn', 'goods', 'purchase', 'payment', 'supplier'],
	purchase_returns: ['debit note', 'return', 'damaged', 'short', 'credit note', 'challan'],
	suppliers: ['vendor', 'gstin', 'weaver', 'statement', 'owed'],
	opening_stock: ['opening', 'first', 'load', 'migration'],
	stock: ['inventory', 'on hand', 'free to sell', 'cost', 'value', 'adjust'],
	stock_held: ['hold', 'photoshoot', 'display', 'release'],
	stock_approvals: ['write-off', 'approve', 'reject', 'loss', 'damage'],
	stock_counts: ['count', 'stocktake', 'audit', 'difference'],
	stock_reorder: ['reorder', 'low stock', 'buy', 'running out'],
	stock_movements: ['ledger', 'history', 'movement'],
	stock_reports: ['ageing', 'dead stock', 'valuation', 'register', 'gstr', 'ca'],
	order_create: ['manual', 'phone', 'purchase'],
	media: ['image', 'photo', 'picture', 'upload', 'library'],
	blog: ['post', 'article', 'news'],
	blog_category: ['post'],
	blog_tag: ['post'],
	page: ['about', 'policy', 'terms', 'privacy'],
	tax: ['gst', 'vat', 'rate'],
	shipping: ['delivery', 'courier', 'shiprocket', 'zone'],
	coupon: ['discount', 'code', 'promo', 'offer'],
	event: ['launch', 'sale', 'countdown', 'popup', 'offer'],
	event_create_launch: ['countdown', 'popup', 'new'],
	event_create_sale: ['discount', 'offer', 'popup'],
	currency: ['usd', 'inr', 'exchange', 'rate', 'fx'],
	point: ['reward', 'loyalty', 'balance'],
	refund: ['return', 'money', 'back'],
	review: ['rating', 'star', 'photo', 'moderation'],
	faq: ['question', 'answer', 'help'],
	theme_option: ['theme', 'layout', 'header', 'footer'],
	home_banners: ['banner', 'hero', 'slider', 'newsletter', 'popup'],
	storefront_setting: ['shop', 'website', 'settings'],
	setting: ['general', 'shop', 'settings'],
	setting_brand: ['logo', 'brand', 'identity'],
	setting_stores: ['branch', 'address', 'map', 'hours', 'contact'],
	setting_mailboxes: ['gmail', 'email', 'google', 'mail'],
	setting_communications: ['message', 'channel', 'sms', 'whatsapp', 'email', 'otp'],
	setting_purchases: ['books', 'closed', 'margin', 'approval', 'steps', 'terms', 'gst'],
	setting_notifications: ['sms', 'whatsapp', 'email', 'otp', 'msg91', 'template'],
};

/** Tabs and sections inside pages, each reached directly. */
export const SECTIONS: AdminSearchEntry[] = [
	{
		id: 'storefront_setting_search',
		path: '/storefront-setting',
		queryParams: { tab: 'search' },
		titleKey: 'search',
		trailKeys: ['store_front', 'storefront_settings'],
		icon: 'ri-search-line',
		keywords: ['meilisearch', 'category', 'first', 'order'],
		permissions: ['theme_option.index'],
	},
	{
		id: 'storefront_setting_youtube',
		path: '/storefront-setting',
		queryParams: { tab: 'youtube' },
		titleKey: 'youtube',
		trailKeys: ['store_front', 'storefront_settings'],
		icon: 'ri-youtube-line',
		keywords: ['video', 'videos', 'shorts', 'channel'],
		permissions: ['theme_option.index'],
	},
	{
		id: 'storefront_setting_share',
		path: '/storefront-setting',
		queryParams: { tab: 'share' },
		titleKey: 'sharing',
		trailKeys: ['store_front', 'storefront_settings'],
		icon: 'ri-share-line',
		keywords: ['share', 'whatsapp', 'via', 'twitter', 'x', 'hashtag', 'pinterest', 'story'],
		permissions: ['theme_option.index'],
	},
	{
		id: 'setting_brand_logo',
		path: '/setting/brand',
		fragment: 'shop_logo_section',
		titleKey: 'full_logo',
		trailKeys: ['settings', 'brand_kit'],
		icon: 'ri-palette-line',
		keywords: ['logo', 'dark', 'wide', 'header'],
		permissions: ['setting.index'],
	},
	{
		id: 'setting_brand_seal',
		path: '/setting/brand',
		fragment: 'shop_seal_section',
		titleKey: 'search_phone_logo_and_icon',
		trailKeys: ['settings', 'brand_kit'],
		icon: 'ri-palette-line',
		keywords: ['favicon', 'icon', 'seal', 'tab', 'logo'],
		permissions: ['setting.index'],
	},
	{
		id: 'setting_brand_admin',
		path: '/setting/brand',
		fragment: 'admin_own_logos',
		titleKey: 'brand_admin_logos',
		trailKeys: ['settings', 'brand_kit'],
		icon: 'ri-palette-line',
		keywords: ['logo', 'admin', 'sidebar'],
		permissions: ['setting.index'],
	},
	{
		id: 'setting_brand_sharing',
		path: '/setting/brand',
		fragment: 'brand_sharing',
		titleKey: 'brand_sharing_and_profiles',
		trailKeys: ['settings', 'brand_kit'],
		icon: 'ri-palette-line',
		keywords: [
			'share',
			'preview',
			'og',
			'social',
			'facebook',
			'instagram',
			'x',
			'twitter',
			'pinterest',
			'linkedin',
			'threads',
			'android',
			'ios',
			'play',
			'app',
			'store',
		],
		permissions: ['setting.index'],
	},
	{
		id: 'setting_brand_colour',
		path: '/setting/brand',
		fragment: 'admin_theme_color',
		titleKey: 'admin_theme_colour',
		trailKeys: ['settings', 'brand_kit'],
		icon: 'ri-palette-line',
		keywords: ['colour', 'color', 'theme', 'green', 'sidebar'],
		permissions: ['setting.index'],
	},
];

/** Places offered under "Go to" when nothing is typed. */
export const QUICK_LINKS = ['product_create', 'order'];

/** Every menu page as a search entry, in menu order, then the sections. */
export function searchEntries(menu: IMenu[]): AdminSearchEntry[] {
	const entries: AdminSearchEntry[] = [];
	const walk = (items: IMenu[], trail: string[], icon: string, inherited: string[]) => {
		for (const item of items) {
			if (!item.title) continue;
			const key = menuTitleKey(item.title);
			const permissions = item.permission ?? inherited;
			if (item.path) {
				const id = idFor(item.path);
				entries.push({
					id,
					path: item.path,
					titleKey: key,
					trailKeys: trail,
					icon: item.icon ?? icon,
					keywords: KEYWORDS[id] ?? [],
					permissions,
				});
			}
			if (item.children?.length) {
				walk(item.children, [...trail, key], item.icon ?? icon, item.acl_permission ?? permissions);
			}
		}
	};
	walk(menu, [], 'ri-file-line', []);
	return [...entries, ...SECTIONS];
}

/** Whether the signed-in operator can open the place (the same rule the sidebar uses). */
export const canOpen = (entry: AdminSearchEntry, held: readonly string[]): boolean =>
	!entry.permissions.length || entry.permissions.some((code) => held.includes(code));

/** Lower case words, Bengali vowel signs kept. */
export const words = (text: string): string[] =>
	text
		.normalize('NFKC')
		.toLowerCase()
		.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/** The text one entry is found by, already split into words. */
export interface IndexedEntry {
	entry: AdminSearchEntry;
	title: string[];
	trail: string[];
	hint: string[];
	keywords: string[];
}

export function indexEntry(entry: AdminSearchEntry, translate: (key: string) => string): IndexedEntry {
	const both = (key: string) => [...words(translate(key)), ...words(key.replace(/_/g, ' '))];
	return {
		entry,
		title: both(entry.titleKey),
		trail: entry.trailKeys.flatMap(both),
		hint: words(translate(`search_hint_${entry.id}`)),
		keywords: entry.keywords.flatMap(words),
	};
}

/** How well one query word fits a list of words: a start beats a part, an exact word beats both. */
function fit(token: string, list: string[], exact: number, start: number, part: number): number {
	let best = 0;
	for (const word of list) {
		if (word === token) return exact;
		if (word.startsWith(token)) best = Math.max(best, start);
		else if (token.length >= 3 && word.includes(token)) best = Math.max(best, part);
	}
	return best;
}

function score(indexed: IndexedEntry, tokens: string[]): number {
	let total = 0;
	for (const token of tokens) {
		const best = Math.max(
			fit(token, indexed.title, 120, 100, 60),
			fit(token, indexed.keywords, 80, 60, 30),
			fit(token, indexed.trail, 45, 35, 15),
			fit(token, indexed.hint, 40, 30, 12),
		);
		if (!best) return 0;
		total += best;
	}
	return total;
}

/** Edit distance, stopping early once it passes `limit`. */
export function distance(a: string, b: string, limit = 2): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let rowBest = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const value = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
			current.push(value);
			rowBest = Math.min(rowBest, value);
		}
		if (rowBest > limit) return limit + 1;
		previous = current;
	}
	return previous[b.length] ?? limit + 1;
}

/** The nearest indexed word to a mistyped one, for words of four letters or more. */
function closest(token: string, vocabulary: Set<string>): string | null {
	if (token.length < 4) return null;
	const limit = token.length >= 7 ? 2 : 1;
	let best: { word: string; gap: number } | null = null;
	for (const word of vocabulary) {
		const gap = distance(token, word, limit);
		if (gap <= limit && (!best || gap < best.gap || (gap === best.gap && word.length < best.word.length))) {
			best = { word, gap };
		}
	}
	return best?.word ?? null;
}

export interface SearchOutcome {
	entries: AdminSearchEntry[];
	/** Set when a mistyped word was read as a close one: what was typed, and what was searched. */
	corrected: { typed: string; used: string } | null;
}

/** The places matching a query, best first. Every word must match somewhere. */
export function searchAdmin(index: IndexedEntry[], query: string, limit = 8): SearchOutcome {
	const tokens = words(query);
	if (!tokens.length) return { entries: [], corrected: null };
	const rank = (list: string[]) =>
		index
			.map((indexed, order) => ({ indexed, order, points: score(indexed, list) }))
			.filter((row) => row.points > 0)
			.sort((a, b) => b.points - a.points || a.order - b.order)
			.slice(0, limit)
			.map((row) => row.indexed.entry);

	const direct = rank(tokens);
	if (direct.length) return { entries: direct, corrected: null };

	const vocabulary = new Set(index.flatMap((row) => [...row.title, ...row.keywords, ...row.trail]));
	const fixed = tokens.map((token) => closest(token, vocabulary) ?? token);
	const changed = tokens.findIndex((token, at) => token !== fixed[at]);
	if (changed < 0) return { entries: [], corrected: null };
	const entries = rank(fixed);
	return {
		entries,
		corrected: entries.length ? { typed: tokens[changed] ?? '', used: fixed[changed] ?? '' } : null,
	};
}

/** The entry for an address: the tab or section when the address names one, else the page. */
export function entryForUrl(entries: AdminSearchEntry[], url: string): AdminSearchEntry | undefined {
	const parsed = new URL(url, 'https://admin.local');
	const path = parsed.pathname.replace(/\/$/, '') || '/';
	const tab = parsed.searchParams.get('tab');
	const fragment = parsed.hash.replace(/^#/, '');
	const onPage = entries.filter((entry) => entry.path === path);
	return (
		onPage.find(
			(entry) => (tab && entry.queryParams?.['tab'] === tab) || (fragment && entry.fragment === fragment),
		) ?? onPage.find((entry) => !entry.queryParams && !entry.fragment)
	);
}
