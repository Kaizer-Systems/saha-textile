import type { AddonTemplate, CategoryPlacement, Product, ProductBundle } from '@saha-textile/contracts';

import { DEMO_FRENCH } from '../src/seed/demo-french';
import { CATALOG_PHOTO_ASSET_IDS, mapDemoCatalogue, type DemoCatalogue } from '../src/seed/map-demo-catalogue';
import {
	BLOUSE_SIZES,
	COLOURS,
	COLOUR_FAMILIES,
	FAMILIES,
	GARMENTS,
	GROUPS,
	LEAVES,
	SECOND_PLACEMENTS,
	SIZES,
	type ColourWord,
	type Family,
	type Leaf,
	type Words,
} from './showcase-catalogue-data';

type DemoProduct = Parameters<typeof mapDemoCatalogue>[0]['products'][number];
type DemoCategory = NonNullable<DemoProduct['categories']>[number];

export const SHOWCASE_SIZE = 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Repeatable randomness, so a second run writes the same catalogue. */
function randomFrom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

const slugOf = (text: string): string =>
	text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

/** Every order and pairing of the three photos, so neighbouring cards look different. */
export const PHOTO_SETS: ReadonlyArray<readonly string[]> = (() => {
	const [a, b, c] = CATALOG_PHOTO_ASSET_IDS;
	return [
		[a, b, c],
		[b, c, a],
		[c, a, b],
		[a, c, b],
		[c, b, a],
		[b, a, c],
		[a, b],
		[b, c],
		[c, a],
		[b, a],
		[c, b],
		[a, c],
		[a],
		[b],
		[c],
	];
})();

export type Scenario =
	| 'simple'
	| 'colour'
	| 'size'
	| 'colour_size'
	| 'compound'
	| 'blouse_design'
	| 'suit_stitching'
	| 'bundle';

export type StockState = 'in_stock' | 'low' | 'out' | 'back' | 'made_to_order';

export type Lifecycle = 'live' | 'draft' | 'disabled' | 'discontinued';

export interface ShowcaseNote {
	id: number;
	leaf: Leaf;
	title: Words;
	description: Words;
	shortDescription: Words;
	scenario: Scenario;
	stock: StockState;
	lifecycle: Lifecycle;
	photos: readonly string[];
	family: Family;
	saleOn: boolean;
	featured: boolean;
	insight: 'bestseller' | 'trending' | null;
	isNew: boolean;
	rating: { avg: number; count: number };
}

export interface ShowcaseInput {
	/** The ids the demo seed already uses, so those rows are replaced rather than left behind. */
	productIds: readonly number[];
	categoryIds: ReadonlyMap<string, number>;
	now: Date;
}

const money = (value: number): number => (value >= 2000 ? Math.round(value / 100) * 100 : Math.round(value / 50) * 50);

function nounFor(leaf: Leaf): Words {
	if (leaf.noun) return leaf.noun;
	const french = DEMO_FRENCH[leaf.name] ?? leaf.name;
	return { en: `${leaf.name} Saree`, fr: `Sari ${french}` };
}

/** A title no other product has: shade, motif, then the noun of its category. */
function titleFor(leaf: Leaf, position: number, used: Set<string>, garment: Words | null): { title: Words; shade: ColourWord; motif: Words } {
	const family = FAMILIES[leaf.family] as Family;
	const noun = nounFor(leaf);
	for (let attempt = 0; ; attempt += 1) {
		const shade = COLOURS[(position * 7 + attempt * 5 + leaf.path.length) % COLOURS.length] as ColourWord;
		const motif = family.motifs[(position + attempt) % family.motifs.length] as Words;
		const lead = leaf.path.endsWith('red-and-white') ? '' : `${shade.en} `;
		const en = `${lead}${motif.en} ${noun.en}${garment ? ` ${garment.en}` : ''}`;
		if (used.has(en)) continue;
		used.add(en);
		const after = leaf.path.endsWith('red-and-white') ? '' : ` ${shade.fr}`;
		const fr = garment ? `${garment.fr} ${noun.fr} ${motif.fr}${after}` : `${noun.fr} ${motif.fr}${after}`;
		return { title: { en, fr }, shade, motif };
	}
}

function scenarioFor(leaf: Leaf, family: Family, roll: number): Scenario {
	if (leaf.family === 'suits') {
		if (roll < 0.3) return 'simple';
		if (roll < 0.6) return 'size';
		if (roll < 0.75) return 'colour_size';
		return 'suit_stitching';
	}
	if (leaf.path.endsWith('sarees-with-ready-blouse')) return roll < 0.7 ? 'size' : 'colour_size';
	if (roll < 0.14) return 'colour';
	if (roll < 0.19) return 'compound';
	if (family.tailored && roll < 0.42) return 'blouse_design';
	return 'simple';
}

function stockFor(family: Family, roll: number): StockState {
	if (roll < 0.03) return 'out';
	if (roll < 0.08) return 'low';
	if (roll < 0.11) return 'back';
	if (family.tailored && roll < 0.15) return 'made_to_order';
	return 'in_stock';
}

/** Non-live rows sit at fixed places, so every status is always present. */
function lifecycleFor(index: number): Lifecycle {
	if (index % 53 === 7) return 'disabled';
	if (index % 97 === 11) return 'draft';
	if (index % 131 === 13) return 'discontinued';
	return 'live';
}

function categoryChain(leaf: Leaf, ids: ReadonlyMap<string, number>): DemoCategory[] {
	const parts = leaf.path.split('/');
	return parts.map((slug, index) => {
		const path = parts.slice(0, index + 1).join('/');
		const group = GROUPS.find((row) => row.path === path);
		return {
			id: ids.get(path) as number,
			name: group?.name ?? leaf.name,
			slug,
			parent_id: index === 0 ? null : (ids.get(parts.slice(0, index).join('/')) as number),
			canonical_path: path,
			status: 1,
		};
	});
}

/** Keeps known category ids and gives new menu entries the next free ones. */
export function categoryIdsFor(known: ReadonlyMap<string, number>): Map<string, number> {
	const ids = new Map(known);
	let next = Math.max(2000, ...known.values()) + 1;
	for (const path of [...GROUPS.map((row) => row.path), ...LEAVES.map((row) => row.path)]) {
		if (!ids.has(path)) ids.set(path, next++);
	}
	return ids;
}

const hexFor = (family: string): string => COLOUR_FAMILIES[family] as string;

function colourAttribute(families: readonly string[]) {
	return {
		id: 1,
		name: 'Color',
		slug: 'color',
		style: 'color',
		attribute_values: families.map((value) => ({ value, slug: slugOf(value), hex_color: hexFor(value) })),
	};
}

function sizeAttribute(leaf: Leaf, position: number) {
	const blouse = leaf.path.endsWith('sarees-with-ready-blouse');
	const values = blouse ? BLOUSE_SIZES : SIZES;
	const style = ['rectangle', 'circle', 'radio', 'dropdown'][position % 4];
	return {
		id: 2,
		name: blouse ? 'Blouse Size' : 'Size',
		slug: blouse ? 'blouse-size' : 'size',
		style,
		attribute_values: values.map((value) => ({ value, slug: value.toLowerCase() })),
	};
}

const BLOUSE_DESIGN = {
	code: 'blouse-design',
	label: 'Blouse Designs',
	required: true,
	default_term_code: 'no-design',
	style: 'image_tile',
	terms: [
		{ code: 'no-design', label: 'No Design', price_delta: 0, is_default: true },
		{ code: 'design-1', label: 'Boat Neck Blouse', price_delta: 750, requires_measurements: true },
		{ code: 'design-2', label: 'Sweetheart Neck Blouse', price_delta: 950, requires_measurements: true },
		{ code: 'design-3', label: 'Princess Cut Blouse', price_delta: 1200, requires_measurements: true },
	],
};

const SUIT_STITCHING = {
	code: 'suit-stitching',
	label: 'Stitching',
	required: true,
	default_term_code: 'unstitched',
	style: 'radio',
	terms: [
		{ code: 'unstitched', label: 'Unstitched Piece', price_delta: 0, is_default: true },
		{ code: 'semi-stitched', label: 'Semi Stitched', price_delta: 650, requires_measurements: true },
		{ code: 'fully-stitched', label: 'Fully Stitched', price_delta: 1200, requires_measurements: true },
	],
};

const BLOUSE_FIELDS = [
	{ code: 'shoulder', label: 'Shoulder', unit: 'in', min: 10, max: 24 },
	{ code: 'chest', label: 'Chest', unit: 'in', min: 24, max: 50 },
	{ code: 'waist', label: 'Waist', unit: 'in', min: 22, max: 48 },
	{ code: 'sleeve', label: 'Sleeve', unit: 'in', min: 4, max: 26 },
];

const SUIT_FIELDS: AddonTemplate['fields'] = [
	['bust', 'Bust', 'Poitrine', 26, 56],
	['waist', 'Waist', 'Taille', 22, 52],
	['hip', 'Hip', 'Hanches', 28, 58],
	['kurta-length', 'Kurta Length', 'Longueur du kurta', 30, 56],
	['bottom-length', 'Bottom Length', 'Longueur du bas', 30, 46],
].map(([code, en, fr, min, max]) => ({
	code: code as string,
	label: { en: en as string, fr: fr as string },
	type: 'number' as const,
	unit: 'in' as const,
	required: false,
	validation: { min: min as number, max: max as number, step: 0.5, decimals: 1 },
}));

/** Variation rows for the axes a product has. A sold-out shade appears now and then. */
function variationsFor(
	id: number,
	sku: string,
	colours: readonly string[],
	sizes: readonly string[],
	price: number,
	sale: number,
	random: () => number,
) {
	const rows = (colours.length ? colours : ['']).flatMap((colour) =>
		(sizes.length ? sizes : ['']).map((size) => [colour, size].filter(Boolean).join(' / ')),
	);
	return rows.map((name, index) => {
		const uplift = sizes.length && index % sizes.length >= sizes.length - 2 ? 150 : 0;
		return {
			id: id * 100 + index + 1,
			name,
			price: price + uplift,
			sale_price: sale + uplift,
			sku: `${sku}-${slugOf(name).toUpperCase()}`,
			quantity: random() < 0.15 ? 0 : 2 + Math.floor(random() * 12),
			status: 1,
		};
	});
}

function coloursNear(shade: ColourWord, random: () => number): string[] {
	const others = Object.keys(COLOUR_FAMILIES).filter((name) => name !== shade.family);
	const start = Math.floor(random() * others.length);
	return [shade.family, others[start % others.length] as string, others[(start + 3) % others.length] as string];
}

export interface Showcase {
	products: DemoProduct[];
	notes: ReadonlyMap<number, ShowcaseNote>;
}

/** The products, in the shape the demo mapper reads, and what the mapper cannot carry. */
export function buildShowcaseProducts({ productIds, categoryIds, now }: ShowcaseInput): Showcase {
	const ids = [...productIds].sort((a, b) => a - b);
	let nextId = Math.max(3000, ...ids) + 1;
	const used = new Set<string>();
	const products: DemoProduct[] = [];
	const notes = new Map<number, ShowcaseNote>();
	let index = 0;

	for (const leaf of LEAVES) {
		const family = FAMILIES[leaf.family] as Family;
		for (let position = 0; position < leaf.count; position += 1) {
			const id = ids[index] ?? nextId++;
			const random = randomFrom(id * 2654435761);
			const garment = leaf.family === 'suits' ? (GARMENTS[position % GARMENTS.length] as Words) : null;
			const { title, shade, motif } = titleFor(leaf, position, used, garment);
			const bundle = leaf.path.endsWith('sarees-with-ready-blouse') && position < 3;
			const suitBundle = leaf.path.endsWith('party-wear-suits') && position < 3;
			const scenario: Scenario = bundle || suitBundle ? 'bundle' : scenarioFor(leaf, family, random());
			const stockRoll = random();
			const stock = scenario === 'bundle' ? 'in_stock' : stockFor(family, stockRoll);
			const lifecycle = scenario === 'bundle' ? 'live' : lifecycleFor(index);
			const [low, high] = family.priceINR;
			const price = money(low + (high - low) * random() ** 2);
			const saleOn = random() < 0.22;
			const sale = saleOn ? money(price * (0.7 + random() * 0.2)) : price;
			const sku = `ST-${leaf.path.split('/').at(-1)?.slice(0, 3).toUpperCase() ?? 'SKU'}-${String(id).padStart(4, '0')}`;
			const fabric = leaf.fabric ?? family.fabric;
			const occasion = family.occasion[position % family.occasion.length] as string;
			const work = family.work[position % family.work.length] as string;
			const pattern = family.pattern[position % family.pattern.length] as string;
			const axisColours = scenario === 'colour' || scenario === 'compound' || scenario === 'colour_size' ? coloursNear(shade, random) : [];
			const size = scenario === 'size' || scenario === 'colour_size' ? sizeAttribute(leaf, position) : null;
			const sizes = size ? size.attribute_values.map((row) => row.value).slice(0, scenario === 'colour_size' ? 3 : 5) : [];
			const quantity = {
				in_stock: 3 + Math.floor(random() * 22),
				low: 1 + Math.floor(random() * 2),
				out: 0,
				back: 2 + Math.floor(random() * 4),
				made_to_order: 0,
			}[stock];
			const madeToOrder = stock === 'made_to_order';
			const story = family.story;
			const description = {
				en: `${title.en}. ${story.en} ${motif.en} is what sets this piece apart. Dry clean for the first wash, and store it folded in muslin.`,
				fr: `${title.fr}. ${story.fr} ${motif.fr} distingue cette pièce. Nettoyage à sec pour le premier lavage, puis rangement plié dans une mousseline.`,
			};
			const shortDescription = { en: `${motif.en}. ${story.en}`, fr: `${motif.fr}. ${story.fr}` };
			const isNew = random() < 0.08;
			const insightRoll = random();
			const product: DemoProduct = {
				id,
				name: title.en,
				slug: slugOf(title.en),
				description: description.en,
				short_description: shortDescription.en,
				type: scenario === 'bundle' ? 'bundle' : axisColours.length || size ? 'classified' : 'simple',
				price,
				sale_price: sale,
				quantity,
				sku,
				status: lifecycle === 'draft' ? 0 : 1,
				is_featured: random() < 0.12,
				created_at: new Date(now.getTime() - (isNew ? 1 + Math.floor(random() * 25) : 40 + Math.floor(random() * 500)) * DAY).toISOString(),
				categories: categoryChain(leaf, categoryIds),
				filter_attributes: {
					fabric,
					...(axisColours.length ? {} : { color: shade.family }),
					occasion,
					work,
					pattern,
				},
				...(madeToOrder
					? { estimated_delivery_text: 'Woven to order, ready in 3 to 4 weeks' }
					: { estimated_delivery_text: 'Ships from Kolkata in 2 to 3 working days' }),
			};
			if (axisColours.length || size) {
				product.attributes = [...(axisColours.length ? [colourAttribute(axisColours)] : []), ...(size ? [size] : [])];
				product.variations = variationsFor(id, sku, axisColours, sizes, price, sale, random);
			}
			if (scenario === 'blouse_design') {
				product.addon_groups = [BLOUSE_DESIGN];
				product.measurement_fields = BLOUSE_FIELDS;
			}
			if (scenario === 'suit_stitching') product.addon_groups = [SUIT_STITCHING];
			products.push(product);
			notes.set(id, {
				id,
				leaf,
				title,
				description,
				shortDescription,
				scenario,
				stock,
				lifecycle,
				photos: PHOTO_SETS[(index * 5 + position) % PHOTO_SETS.length] as readonly string[],
				family,
				saleOn,
				featured: Boolean(product.is_featured),
				insight: insightRoll < 0.05 ? 'bestseller' : insightRoll < 0.09 ? 'trending' : null,
				isNew,
				rating: random() < 0.55 ? { avg: Math.round((3.5 + random() * 1.5) * 10) / 10, count: 3 + Math.floor(random() * 140) } : { avg: 0, count: 0 },
			});
			index += 1;
		}
	}
	return { products, notes };
}

const withFrench = (label: Record<string, string>): Record<string, string> =>
	label['fr'] ? label : { ...label, fr: label['en'] as string };

function finishProduct(doc: Product, note: ShowcaseNote, now: Date): Product {
	const { title, description, shortDescription, photos, scenario, stock, lifecycle } = note;
	const altOverrides = Object.fromEntries(photos.map((id) => [id, title]));
	const measures = scenario === 'blouse_design' || scenario === 'suit_stitching';
	const suitGuide = note.leaf.family === 'suits' && scenario !== 'bundle';
	const saree = note.leaf.path.startsWith('sarees/');
	const liveAt = doc.lifecycle.liveAt;
	return {
		...doc,
		type: scenario === 'bundle' ? 'bundle' : doc.type,
		title,
		description,
		shortDescription,
		seo: {
			title: { en: `${title.en} | Saha Textile`, fr: `${title.fr} | Saha Textile` },
			description: shortDescription,
		},
		media: { gallery: [...photos], compound: [], altOverrides },
		optionGroups: doc.optionGroups.map((group) => ({
			...group,
			label: withFrench(group.label) as typeof group.label,
			terms: group.terms.map((term, index) => ({
				...term,
				label: withFrench(term.label) as typeof term.label,
				...(group.displayStyle === 'image_tile'
					? { swatchAssetId: CATALOG_PHOTO_ASSET_IDS[index % CATALOG_PHOTO_ASSET_IDS.length] as string }
					: {}),
			})),
		})),
		status: lifecycle,
		lifecycle: {
			...doc.lifecycle,
			liveAt: lifecycle === 'draft' ? null : liveAt,
			disabledAt: lifecycle === 'disabled' ? now.toISOString() : null,
			discontinuedAt: lifecycle === 'discontinued' ? now.toISOString() : null,
		},
		madeToOrder: stock === 'made_to_order',
		estimatedDeliveryText:
			stock === 'made_to_order'
				? { en: 'Woven to order, ready in 3 to 4 weeks', fr: 'Tissé sur commande, prêt en 3 à 4 semaines' }
				: { en: 'Ships from Kolkata in 2 to 3 working days', fr: 'Expédié de Calcutta sous 2 à 3 jours ouvrés' },
		lifetimeUnitsReceived: 25,
		backInStockAt: stock === 'back' ? new Date(now.getTime() - 3 * DAY).toISOString() : null,
		featured: note.featured,
		insightBadges: note.insight ? [note.insight] : [],
		ratingsSummary: note.rating,
		sareeLengthM: saree ? (note.rating.count % 2 ? 5.5 : 6.3) : null,
		blousePieceM: saree && note.rating.count % 5 ? 0.8 : null,
		addonTemplateCode: suitGuide ? SUIT_TEMPLATE_CODE : measures ? BLOUSE_TEMPLATE_CODE : null,
		shippingDefaults: { weightGrams: note.family.weightGrams, lengthCm: 35, widthCm: 28, heightCm: 4 },
		hsnCode: note.family.hsn,
		tags: [note.leaf.family],
	};
}

const SUIT_SIZE_GUIDE: AddonTemplate['sizeGuide'] = [
	['S', 34, 28, 37],
	['M', 36, 30, 39],
	['L', 38, 32, 41],
	['XL', 40, 34, 43],
	['XXL', 43, 37, 46],
].map(([size, bust, waist, hip]) => ({
	size: size as string,
	values: { bust: bust as number, waist: waist as number, hip: hip as number, 'kurta-length': 44, 'bottom-length': 39 },
}));

const BLOUSE_TEMPLATE_CODE = 'blouse-measurements';
const SUIT_TEMPLATE_CODE = 'suit-measurements';

function bundlesFor(docs: readonly Product[], notes: ReadonlyMap<number, ShowcaseNote>): ProductBundle[] {
	const noteOf = (doc: Product) => notes.get(Number(doc.id.replace('prd_', ''))) as ShowcaseNote;
	const plain = docs.filter((doc) => noteOf(doc).scenario === 'simple' && noteOf(doc).lifecycle === 'live' && noteOf(doc).stock === 'in_stock');
	return docs
		.filter((doc) => noteOf(doc).scenario === 'bundle')
		.map((doc, index) => {
			const parts = [0, 1].map((slot) => plain[(index * 11 + slot * 37) % plain.length] as Product);
			return {
				id: `bnd_${doc.id}`,
				productId: doc.id,
				bundleType: index % 2 === 0 ? ('fixed_kit' as const) : ('choose_one_per_group' as const),
				pricePolicy: 'fixed_bundle_price' as const,
				fixedPriceINR: doc.basePriceINR,
				groups: [
					{
						code: 'set',
						label: { en: 'In this set', fr: 'Dans cet ensemble' },
						minSelections: index % 2 === 0 ? 2 : 1,
						maxSelections: index % 2 === 0 ? 2 : 1,
						components: parts.map((part) => ({
							productId: part.id,
							variantId: null,
							quantity: 1,
							required: index % 2 === 0,
							priceAdjustmentINR: null,
						})),
					},
				],
				status: 'live' as const,
			};
		});
}

/** Puts on the mapped catalogue everything the demo shape has no field for. */
export function finishShowcase(mapped: DemoCatalogue, showcase: Showcase, now: Date): DemoCatalogue {
	const { notes } = showcase;
	const noteOf = (id: string) => notes.get(Number(id.replace('prd_', ''))) as ShowcaseNote;
	const products = mapped.products.map((doc) => finishProduct(doc, noteOf(doc.id), now));
	const variants = mapped.variants.map((row, index) => {
		const note = noteOf(row.productId);
		const status = note.lifecycle === 'live' ? ('live' as const) : ('disabled' as const);
		const quantity = note.scenario === 'simple' || note.scenario === 'blouse_design' || note.scenario === 'suit_stitching' || note.scenario === 'bundle' ? null : row.stock.quantity;
		const zero = note.stock === 'out' || note.stock === 'made_to_order';
		return {
			...row,
			status,
			stock: { ...row.stock, quantity: zero ? 0 : (quantity ?? row.stock.quantity) },
			media: { primaryAssetId: note.photos[index % note.photos.length] as string },
		};
	});
	const compound = products.map((doc) => {
		const note = noteOf(doc.id);
		if (note.scenario !== 'compound') return doc;
		const rows = variants.filter((row) => row.productId === doc.id);
		return {
			...doc,
			imageMode: 'compound' as const,
			media: {
				...doc.media,
				gallery: [],
				compound: rows.map((row, index) => ({
					selectionHash: row.optionSelectionHash,
					gallery: [...(PHOTO_SETS[(index * 4 + note.id) % PHOTO_SETS.length] as readonly string[])],
				})),
			},
		};
	});
	const live = compound.filter((doc) => doc.status === 'live');
	const finished = compound.map((doc, index) =>
		doc.status === 'discontinued'
			? {
					...doc,
					replacementTarget: { kind: 'product' as const, path: `/product/${(live[index % live.length] as Product).slug}` },
				}
			: doc,
	);
	const blouse = mapped.addonTemplates.find((row) => row.code === BLOUSE_TEMPLATE_CODE) as AddonTemplate;
	const suit: AddonTemplate = {
		...blouse,
		id: 'addon_suit_measurements',
		code: SUIT_TEMPLATE_CODE,
		label: { en: 'Suit measurements', fr: 'Mesures de l’ensemble' },
		fields: SUIT_FIELDS,
		sizeGuide: SUIT_SIZE_GUIDE,
	};
	const byPath = new Map(mapped.placements.map((row) => [row.pathSlugs.join('/'), row]));
	const extra: CategoryPlacement[] = SECOND_PLACEMENTS.map(({ path, alsoUnder }) => {
		const own = byPath.get(path) as CategoryPlacement;
		const parent = byPath.get(alsoUnder) as CategoryPlacement;
		const slug = own.pathSlugs.at(-1) as string;
		const label = own.pathLabel.split(' / ').at(-1) as string;
		return {
			...own,
			id: `plc_${[...parent.pathSlugs, slug].join('_')}`,
			parentCategoryId: parent.categoryId,
			pathCategoryIds: [...parent.pathCategoryIds, own.categoryId],
			pathSlugs: [...parent.pathSlugs, slug],
			pathLabel: `${parent.pathLabel} / ${label}`,
			depth: parent.depth + 1,
			isCanonical: false,
		};
	});
	return {
		...mapped,
		products: finished,
		variants,
		bundles: bundlesFor(finished, notes),
		addonTemplates: [blouse, suit],
		placements: [...mapped.placements, ...extra],
		categories: mapped.categories.map((row) => ({
			...row,
			name: withFrench(row.name) as typeof row.name,
			description: {
				en: `${row.name.en} from Saha Textile, Kolkata.`,
				fr: `${row.name['fr'] ?? row.name.en} de Saha Textile, Calcutta.`,
			},
			seo: {
				title: { en: `${row.name.en} | Saha Textile`, fr: `${row.name['fr'] ?? row.name.en} | Saha Textile` },
				description: {
					en: `Shop ${row.name.en} from Saha Textile, Kolkata.`,
					fr: `Découvrez ${row.name['fr'] ?? row.name.en} chez Saha Textile, Calcutta.`,
				},
			},
		})),
		attributeDefinitions: mapped.attributeDefinitions.map((row) => ({
			...row,
			label: withFrench(row.label) as typeof row.label,
			terms: row.terms.map((term) => ({ ...term, label: withFrench(term.label) as typeof term.label })),
		})),
	};
}

export { hexFor as colourHex };
