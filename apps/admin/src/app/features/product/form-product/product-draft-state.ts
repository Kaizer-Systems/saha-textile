/**
 * Save as draft on the product form (product bulk actions brief § 7, approved 2026-11-19).
 *
 * A draft keeps the whole form, unchecked: the form's own values (`raw`), the text of every
 * language-bound field in every language (`text`), and the lists and choices kept beside the form
 * (`state`: options, photos, FAQ, metre settings…). To see what changed, two snapshots are flattened
 * into one value per field path and compared path by path.
 */

export const DRAFT_VERSION = 1;

export interface ProductFormSnapshot {
	v: number;
	raw: Record<string, unknown>;
	text: Record<string, Record<string, string>>;
	state: Record<string, unknown>;
}

/** Kept with the draft for showing it again, but never a change of its own. */
const DERIVED_STATE = new Set(['tiles', 'imageSizes']);

/**
 * Lists whose order means nothing to a draft: the category picker hands back its picks in the
 * category tree's order whenever it loads, which is not a change the admin made.
 */
const ORDERLESS = new Set(['categories', 'tags']);

/** Variant row fields that only label the row. */
const ROW_LABELS = new Set(['id', 'name', 'variation_name']);

/** The tab each form control sits on (read from the form's template). */
const CONTROL_TAB: Readonly<Record<string, string>> = {
	addon_price_inr: 'inventory',
	blouse_piece_m: 'inventory',
	categories: 'setup',
	cross_sell_products: 'setup',
	discount: 'inventory',
	encourage_order: 'status',
	encourage_view: 'status',
	height_cm: 'inventory',
	hidden_badges: 'inventory',
	hsn_code: 'setup',
	is_featured: 'status',
	is_free_shipping: 'shipping',
	length_cm: 'inventory',
	low_stock_threshold: 'inventory',
	made_to_order: 'inventory',
	pinned_badges: 'inventory',
	price: 'inventory',
	product_meta_image_id: 'seo',
	quantity: 'inventory',
	related_products: 'setup',
	replacement_path: 'status',
	return_policy_text: 'shipping',
	safe_checkout: 'status',
	saree_length_m: 'inventory',
	secure_checkout: 'status',
	sku: 'inventory',
	slug: 'seo',
	social_share: 'status',
	status: 'status',
	stock_status: 'inventory',
	tags: 'setup',
	tax_id: 'shipping',
	type: 'inventory',
	upsell_products: 'setup',
	videos: 'images',
	weight: 'inventory',
	width_cm: 'inventory',
};

const TEXT_TAB: Readonly<Record<string, string>> = {
	name: 'general',
	short_description: 'general',
	description: 'general',
	meta_title: 'seo',
	meta_description: 'seo',
	estimated_delivery_text: 'shipping',
};

const STATE_TAB: Readonly<Record<string, string>> = {
	soldBy: 'inventory',
	metreCut: 'inventory',
	metreWidth: 'inventory',
	metreWeight: 'inventory',
	quickLengths: 'inventory',
	optionGroups: 'inventory',
	addonTemplateCode: 'inventory',
	variantImages: 'inventory',
	returnable: 'setup',
	ownCharges: 'shipping',
	images: 'images',
	faq: 'faq',
	bundle: 'bundle',
};

/** The tab a changed field sits on, for its amber dot. */
export function draftTab(path: string): string {
	const [part, name = ''] = path.split('.');
	if (part === 'text') return TEXT_TAB[name] ?? 'general';
	if (part === 'state') return STATE_TAB[name] ?? 'general';
	if (name === 'variations') return 'inventory';
	return CONTROL_TAB[name] ?? 'general';
}

/** One JSON text per value, with object keys in order, so equal values compare equal. */
export function stable(value: unknown): string {
	if (value === undefined || value === null || value === '') return 'null';
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, inner]) => inner !== undefined)
			.sort(([a], [b]) => a.localeCompare(b));
		return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/** Every field of a snapshot as one value per path: `raw.sku`, `raw.variations.var_1.price`, `text.name.bn`. */
export function flattenSnapshot(snapshot: ProductFormSnapshot): Map<string, unknown> {
	const flat = new Map<string, unknown>();
	for (const [key, value] of Object.entries(snapshot.raw ?? {})) {
		if (key in (snapshot.text ?? {})) continue;
		if (key === 'variations' && Array.isArray(value)) {
			for (const row of value as Record<string, unknown>[]) {
				const id = String(row?.['id'] ?? '');
				if (!id) continue;
				for (const [field, inner] of Object.entries(row)) {
					if (!ROW_LABELS.has(field)) flat.set(`raw.variations.${id}.${field}`, inner);
				}
			}
			continue;
		}
		flat.set(`raw.${key}`, ORDERLESS.has(key) && Array.isArray(value) ? value.map(String).sort() : value);
	}
	for (const [field, byLocale] of Object.entries(snapshot.text ?? {})) {
		for (const [locale, text] of Object.entries(byLocale ?? {})) flat.set(`text.${field}.${locale}`, text);
	}
	for (const [name, value] of Object.entries(snapshot.state ?? {})) {
		if (!DERIVED_STATE.has(name)) flat.set(`state.${name}`, value);
	}
	return flat;
}

/** The whole form as one text, for "anything unsaved?". */
export function fingerprint(snapshot: ProductFormSnapshot): string {
	return stable(Object.fromEntries(flattenSnapshot(snapshot)));
}

/** The paths that differ between the product as it was and the form now, with each one's old value. */
export function changedPaths(base: ProductFormSnapshot, next: ProductFormSnapshot): { path: string; from: unknown }[] {
	const before = flattenSnapshot(base);
	const after = flattenSnapshot(next);
	const paths = new Set([...before.keys(), ...after.keys()]);
	return [...paths]
		.filter((path) => stable(before.get(path)) !== stable(after.get(path)))
		.sort()
		.map((path) => ({ path, from: before.get(path) ?? null }));
}

/** A value as the "was:" line under a changed field shows it: plain words, cut short. */
export function describeValue(value: unknown, limit = 80): string {
	let text: string;
	if (value === null || value === undefined || value === '') text = '—';
	else if (typeof value === 'string') text = value.replace(/<[^>]*>/g, ' ');
	else if (Array.isArray(value)) text = value.map((item) => describeValue(item, limit)).join(', ');
	else if (typeof value === 'object') text = '…';
	else text = String(value);
	text = text.replace(/\s+/g, ' ').trim() || '—';
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
