import { defineEventHandler, getQuery } from 'h3';

import categoryData from '../../../../public/assets/data/category.json';
import productData from '../../../../public/assets/data/product.json';

/**
 * Catalog listing endpoint (Pass A) — the seam that replaces "download the whole
 * product.json and filter on the client". Reads the mock JSON once (module scope),
 * then filters → sorts → paginates server-side and returns only a lean 25-card
 * slice PLUS a facet block whose counts are DISJUNCTIVE (a facet's own selection
 * is excluded from its own counts, so multi-select siblings don't zero out). On a
 * real backend this maps 1:1 to a Meilisearch search with facetDistribution.
 */

interface RawProduct {
	id: number;
	name: string;
	slug: string;
	short_description?: string;
	unit?: string;
	price: number;
	sale_price: number;
	discount: number;
	stock_status: string;
	rating_count: number;
	reviews_count: number;
	is_featured?: number;
	is_sale_enable?: number;
	type?: string;
	product_thumbnail?: { original_url?: string };
	categories?: { id: number; slug: string; canonical_path?: string; level?: number }[];
	filter_attributes?: Record<string, string>;
	// config data — only carried through when present (configurable products)
	attributes?: unknown[];
	variations?: unknown[];
	addon_groups?: unknown[];
	measurement_fields?: unknown[];
	bundle?: unknown;
	semantic_attributes?: unknown[];
}

interface CatNode {
	id: number;
	name: string;
	slug: string;
	canonical_path: string;
	placements?: { path: string; canonical?: boolean }[];
}
const PRODUCTS = (productData as { data: RawProduct[] }).data;
const CATEGORIES = (categoryData as { data: CatNode[] }).data;
const NODE_BY_PATH = new Map<string, CatNode>(CATEGORIES.map((c) => [c.canonical_path, c]));
// Every placement path (canonical AND extra merchandising) → node, so an
// extra-placement URL (e.g. sarees/pure-cotton/cotton-chikankari) resolves to the
// same node as its canonical home (dress-materials/cotton-chikankari).
const NODE_BY_PLACEMENT = new Map<string, CatNode>();
for (const c of CATEGORIES) for (const p of c.placements ?? []) NODE_BY_PLACEMENT.set(p.path, c);
const NODE_BY_SLUG = new Map<string, CatNode>();
for (const c of CATEGORIES) if (!NODE_BY_SLUG.has(c.slug)) NODE_BY_SLUG.set(c.slug, c);

/** Resolve a URL path (canonical or extra-placement) — or a bare last-segment slug — to its node. */
function resolveCategoryNode(category: string): CatNode | null {
	if (!category) return null;
	return (
		NODE_BY_PATH.get(category) ??
		NODE_BY_PLACEMENT.get(category) ??
		NODE_BY_SLUG.get(category.split('/').pop() ?? category) ??
		null
	);
}

/** Breadcrumb trail (L1→node) built from the resolved node's CANONICAL path — so extra-placement URLs still trail through the canonical home. */
function breadcrumbChain(node: CatNode | null): { name: string; path: string }[] {
	if (!node) return [];
	const segs = node.canonical_path.split('/');
	const trail: { name: string; path: string }[] = [];
	const acc: string[] = [];
	for (const s of segs) {
		acc.push(s);
		const n = NODE_BY_PATH.get(acc.join('/'));
		if (n) trail.push({ name: n.name, path: n.canonical_path });
	}
	return trail;
}

// Facet keys sourced from product.filter_attributes.
const ATTR_FACETS = ['fabric', 'color', 'occasion', 'work'] as const;

const csv = (v: unknown): string[] =>
	typeof v === 'string' && v.length
		? v
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: [];

/** A product belongs to a category if that node id is anywhere in its chain (products carry full ancestor + placement chains). */
const inCategory = (p: RawProduct, catId: number | null) =>
	catId == null || !!p.categories?.some((c) => c.id === catId);

const attrMatch = (p: RawProduct, key: string, selected: string[]) =>
	!selected.length || selected.includes(p.filter_attributes?.[key] ?? '');

const ratingMatch = (p: RawProduct, min: number) => !min || p.rating_count >= min;
const priceMatch = (p: RawProduct, lo: number, hi: number) =>
	(!lo || p.sale_price >= lo) && (!hi || p.sale_price <= hi);

function sortProducts(list: RawProduct[], sortBy: string): RawProduct[] {
	const s = [...list];
	switch (sortBy) {
		case 'a-z':
			return s.sort((a, b) => a.name.localeCompare(b.name));
		case 'z-a':
			return s.sort((a, b) => b.name.localeCompare(a.name));
		case 'low-high':
			return s.sort((a, b) => a.sale_price - b.sale_price);
		case 'high-low':
			return s.sort((a, b) => b.sale_price - a.sale_price);
		case 'desc':
			return s.sort((a, b) => b.id - a.id);
		default:
			return s.sort((a, b) => a.id - b.id);
	}
}

/** Lean card projection — config data only for configurable products (so the card's Add-modal still works) without fattening the 380 simple ones. */
function toLean(p: RawProduct) {
	const configurable = !!(p.variations?.length || p.addon_groups?.length || p.bundle);
	return {
		id: p.id,
		name: p.name,
		slug: p.slug,
		short_description: p.short_description ?? '',
		unit: p.unit ?? '',
		price: p.price,
		sale_price: p.sale_price,
		discount: p.discount,
		stock_status: p.stock_status,
		rating_count: p.rating_count,
		reviews_count: p.reviews_count,
		is_featured: p.is_featured ?? 0,
		is_sale_enable: p.is_sale_enable ?? 0,
		type: p.type ?? 'simple',
		product_thumbnail: p.product_thumbnail ?? null,
		filter_attributes: p.filter_attributes ?? {},
		...(configurable
			? {
					attributes: p.attributes,
					variations: p.variations,
					addon_groups: p.addon_groups,
					measurement_fields: p.measurement_fields,
					bundle: p.bundle,
					semantic_attributes: p.semantic_attributes,
				}
			: {}),
	};
}

function facetCounts(products: RawProduct[]): Record<string, { value: string; count: number }[]> {
	const out: Record<string, { value: string; count: number }[]> = {};
	for (const key of ATTR_FACETS) {
		const m = new Map<string, number>();
		for (const p of products) {
			const v = p.filter_attributes?.[key];
			if (v) m.set(v, (m.get(v) ?? 0) + 1);
		}
		out[key] = [...m.entries()]
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => a.value.localeCompare(b.value));
	}
	return out;
}

export default defineEventHandler((event) => {
	const q = getQuery(event);
	const categoryNode = resolveCategoryNode(String(q['category'] ?? ''));
	const catId = categoryNode ? categoryNode.id : null;
	const page = Math.max(1, Number(q['page'] ?? 1) || 1);
	const limit = Math.min(50, Math.max(1, Number(q['limit'] ?? 25) || 25));
	const sortBy = String(q['sortBy'] ?? q['sort'] ?? '');
	const rating = Number(q['rating'] ?? 0) || 0;
	const priceLo = Number(q['price_min'] ?? 0) || 0;
	const priceHi = Number(q['price_max'] ?? 0) || 0;
	const selected: Record<string, string[]> = {};
	for (const key of ATTR_FACETS) selected[key] = csv(q[key]);

	// Base = products in this category (facet counts are always within the category scope).
	const base = PRODUCTS.filter((p) => inCategory(p, catId));

	// Predicate for every filter EXCEPT one key (for disjunctive facet counting).
	const passesExcept = (p: RawProduct, exceptKey: string | null) => {
		if (!ratingMatch(p, rating)) return false;
		if (!priceMatch(p, priceLo, priceHi)) return false;
		for (const key of ATTR_FACETS) {
			if (key === exceptKey) continue;
			if (!attrMatch(p, key, selected[key])) return false;
		}
		return true;
	};

	// Fully-filtered result set (all filters applied).
	const filtered = base.filter(
		(p) => passesExcept(p, null) && ATTR_FACETS.every((k) => attrMatch(p, k, selected[k])),
	);
	const sorted = sortProducts(filtered, sortBy);
	const total = sorted.length;
	const start = (page - 1) * limit;
	const items = sorted.slice(start, start + limit).map(toLean);

	// Disjunctive facets: each attr facet counted over base+all-other-filters (its own selection excluded);
	// rating/price counted over the fully-filtered attr set.
	const facets: Record<string, { value: string; count: number }[]> = {};
	for (const key of ATTR_FACETS) {
		facets[key] = facetCounts(base.filter((p) => passesExcept(p, key)))[key];
	}

	return {
		data: items,
		total,
		page,
		limit,
		last_page: Math.max(1, Math.ceil(total / limit)),
		// Resolved category (its CANONICAL identity, even when reached via an extra
		// placement URL) + its breadcrumb trail — the page uses these for the
		// canonical <link>, title, and breadcrumb.
		category: categoryNode
			? { id: categoryNode.id, name: categoryNode.name, canonical_path: categoryNode.canonical_path }
			: null,
		breadcrumb: breadcrumbChain(categoryNode),
		facets,
		price_range: base.length
			? { min: Math.min(...base.map((p) => p.sale_price)), max: Math.max(...base.map((p) => p.sale_price)) }
			: { min: 0, max: 0 },
	};
});
