import type {
	AddonTemplate,
	AttributeDefinition,
	Category,
	CategoryPlacement,
	ImageDerivative,
	MediaAsset,
	Product,
	ProductBundle,
	ProductVariant,
} from '@saha-textile/contracts';

/**
 * The three product photos already on the dev Spaces bucket. Every seeded product
 * uses these, in a rotated order. Hero and blog art are not part of this seed.
 */
export const CATALOG_PHOTO_ASSET_IDS = [
	'med_8f9be002-e0fe-40d0-b110-13c047985d27',
	'med_a0eea098-348c-40f0-baff-77a975af6ee5',
	'med_87ba75fc-51f5-48b5-945f-575ca18b3288',
] as const;

/** Product n starts on photo n, then the other two. Neighbours do not share a primary. */
export function catalogPhotoFrames(index: number): [string, string, string] {
	const start = ((Math.trunc(index) % 3) + 3) % 3;
	return [0, 1, 2].map((offset) => CATALOG_PHOTO_ASSET_IDS[(start + offset) % 3]) as [string, string, string];
}

const DISPLAY_STYLE: Record<string, AttributeDefinition['defaultDisplayStyle']> = {
	color: 'color_swatch',
	color_swatch: 'color_swatch',
	rectangle: 'rectangle',
	circle: 'circle',
	radio: 'radio',
	image: 'image_swatch',
	image_swatch: 'image_swatch',
	dropdown: 'dropdown',
	radio_bar: 'radio_bar',
};

export interface DemoCatalogue {
	categories: Category[];
	placements: CategoryPlacement[];
	attributeDefinitions: AttributeDefinition[];
	products: Product[];
	variants: ProductVariant[];
	addonTemplates: AddonTemplate[];
	bundles: ProductBundle[];
	/** Fallback media rows, used only when the asset is not already in the database. */
	photoAssets: MediaAsset[];
}

interface DemoTerm {
	value?: string;
	slug?: string;
	hex_color?: string | null;
}

interface DemoAttribute {
	name?: string;
	slug?: string;
	style?: string;
	attribute_values?: DemoTerm[];
}

interface DemoCategory {
	id: number;
	name?: string;
	slug?: string;
	parent_id?: number | null;
	canonical_path?: string;
	status?: number;
}

interface DemoVariation {
	id?: number;
	name?: string;
	price?: number;
	sale_price?: number;
	sku?: string;
	quantity?: number;
	status?: number;
}

interface DemoMeasurement {
	code?: string;
	label?: string;
	unit?: string;
	min?: number;
	max?: number;
}

interface DemoProduct {
	id: number;
	name?: string;
	slug?: string;
	description?: string;
	short_description?: string;
	type?: string;
	price?: number;
	sale_price?: number;
	quantity?: number;
	sku?: string;
	status?: number | boolean;
	deleted_at?: string | null;
	is_featured?: number | boolean;
	created_at?: string;
	categories?: DemoCategory[];
	attributes?: DemoAttribute[];
	variations?: DemoVariation[];
	measurement_fields?: DemoMeasurement[];
	addon_groups?: DemoOptionGroup[];
	semantic_attributes?: Array<{ code?: string; label?: string; value?: string }>;
	bundle?: {
		option_groups?: DemoOptionGroup[];
		components?: Array<{ sku?: string; quantity?: number }>;
		measurement_fields?: DemoMeasurement[];
	};
	estimated_delivery_text?: string;
	tags?: Array<{ name?: string; slug?: string }>;
}

interface DemoOptionGroup {
	code?: string;
	label?: string;
	required?: boolean;
	default_term_code?: string;
	style?: string;
	terms?: Array<{
		code?: string;
		label?: string;
		price_delta?: number;
		is_default?: boolean;
		requires_measurements?: boolean;
	}>;
}

interface DemoAttributeMaster {
	name?: string;
	slug?: string;
	style?: string;
	attribute_values?: DemoTerm[];
}

const rupee = (value: unknown): number => {
	const number = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(number) || number < 0) return 0;
	return Math.round(number);
};

const text = (value: string | undefined, fallback: string): { en: string } => ({
	en: (value && value.trim()) || fallback,
});

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'item';

const claim = (seen: Set<string>, raw: string, owner: string): string => {
	const base = raw.trim() || `sku-${owner}`;
	if (!seen.has(base)) {
		seen.add(base);
		return base;
	}
	let next = `${base}-${owner}`;
	let n = 2;
	while (seen.has(next)) next = `${base}-${owner}-${n++}`;
	seen.add(next);
	return next;
};

const hashOf = (selections: Array<{ attributeCode: string; termCode: string }>): string =>
	[...selections]
		.sort((a, b) => a.attributeCode.localeCompare(b.attributeCode))
		.map((selection) => `${selection.attributeCode}:${selection.termCode}`)
		.join('|');

const isBaseLabel = (value: string): boolean => /no stitching|no blouse|unstitched/i.test(value);

const MEASUREMENT_TEMPLATE_ID = 'addon_blouse_measurements';

type OptionGroup = Product['optionGroups'][number];

/** A demo add-on or bundle group as a per-product option group. */
function demoGroup(group: DemoOptionGroup, role: 'named_add_on' | 'bundle_component_option'): OptionGroup | null {
	const code = slugify(group.code || group.label || '');
	const terms = (group.terms ?? []).filter((term) => term.code || term.label);
	if (!code || terms.length === 0) return null;
	const defaultCode = slugify(
		group.default_term_code || terms.find((term) => term.is_default)?.code || terms[0]!.code || '',
	);
	return {
		attributeCode: code,
		label: text(group.label, code),
		semanticRole: role,
		displayStyle: group.style === 'image_tile' ? 'image_tile' : (DISPLAY_STYLE[group.style ?? ''] ?? 'rectangle'),
		requiredSelection: Boolean(group.required),
		defaultTermCode: defaultCode,
		terms: terms.map((term, index) => {
			const termCode = slugify(term.code || term.label || `term-${index + 1}`);
			const requiresMeasurements = Boolean(term.requires_measurements);
			return {
				code: termCode,
				label: text(term.label, termCode),
				isBase: role === 'named_add_on' && termCode === defaultCode,
				priceDeltaINR: rupee(term.price_delta),
				addonTemplateIds: requiresMeasurements ? [MEASUREMENT_TEMPLATE_ID] : [],
				requiresMeasurements,
				sortOrder: index,
			};
		}),
	};
}

/** Variation axes, named add-ons, filter-only facts, and bundle options for one product. */
function optionGroupsFor(product: DemoProduct, variable: boolean, frames: readonly string[]): OptionGroup[] {
	const groups: OptionGroup[] = [];
	const seen = new Set<string>();
	const add = (group: OptionGroup | null) => {
		if (!group || seen.has(group.attributeCode)) return;
		seen.add(group.attributeCode);
		groups.push(group);
	};
	for (const attribute of product.attributes ?? []) {
		const values = attribute.attribute_values ?? [];
		const code = slugify(attribute.slug || attribute.name || '');
		if (!code || values.length === 0) continue;
		const style = DISPLAY_STYLE[attribute.style ?? ''] ?? 'rectangle';
		add({
			attributeCode: code,
			label: text(attribute.name, code),
			semanticRole: variable ? 'variation_axis' : 'filter_only',
			displayStyle: style,
			requiredSelection: variable,
			defaultTermCode: null,
			terms: values.map((term, index) => {
				const label = term.value || term.slug || `Term ${index + 1}`;
				const hex =
					typeof term.hex_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(term.hex_color)
						? term.hex_color
						: undefined;
				return {
					code: slugify(term.slug || label),
					label: text(label, label),
					isBase: isBaseLabel(label),
					...(hex ? { hex } : {}),
					...(style === 'image_swatch' ? { swatchAssetId: frames[index % frames.length]! } : {}),
					addonTemplateIds: [],
					requiresMeasurements: false,
					sortOrder: index,
				};
			}),
		});
	}
	for (const group of product.addon_groups ?? []) add(demoGroup(group, 'named_add_on'));
	for (const group of product.bundle?.option_groups ?? []) add(demoGroup(group, 'bundle_component_option'));
	for (const fact of product.semantic_attributes ?? []) {
		const code = slugify(fact.code || fact.label || '');
		const value = (fact.value ?? '').trim();
		if (!code || !value) continue;
		add({
			attributeCode: code,
			label: text(fact.label && fact.label.charAt(0).toUpperCase() + fact.label.slice(1), code),
			semanticRole: 'filter_only',
			displayStyle: 'rectangle',
			requiredSelection: false,
			defaultTermCode: null,
			terms: [
				{
					code: slugify(value),
					label: text(value, value),
					isBase: false,
					addonTemplateIds: [],
					requiresMeasurements: false,
					sortOrder: 0,
				},
			],
		});
	}
	return groups;
}

function selectionsFor(
	variation: DemoVariation,
	attributes: DemoAttribute[],
): Array<{ attributeCode: string; termCode: string }> {
	const parts = (variation.name ?? '')
		.split(' / ')
		.map((part) => part.trim())
		.filter(Boolean);
	if (attributes.length > 0 && parts.length === attributes.length) {
		return attributes.map((attribute, index) => {
			const code = slugify(attribute.slug || attribute.name || `axis-${index}`);
			const term = (attribute.attribute_values ?? []).find(
				(candidate) =>
					candidate.value?.toLowerCase() === parts[index]?.toLowerCase() ||
					candidate.slug === slugify(parts[index] ?? ''),
			);
			return { attributeCode: code, termCode: slugify(term?.slug || term?.value || parts[index] || 'term') };
		});
	}
	if (attributes.length === 1) {
		const attribute = attributes[0]!;
		const code = slugify(attribute.slug || attribute.name || 'axis');
		const term = (attribute.attribute_values ?? []).find(
			(candidate) => candidate.value?.toLowerCase() === (variation.name ?? '').toLowerCase(),
		);
		return [{ attributeCode: code, termCode: slugify(term?.slug || term?.value || variation.name || 'term') }];
	}
	return [{ attributeCode: 'item', termCode: slugify(variation.name || `var-${variation.id ?? 'base'}`) }];
}

function collectDerivatives(node: unknown, into: Map<string, ImageDerivative[]>): void {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const child of node) collectDerivatives(child, into);
		return;
	}
	const record = node as Record<string, unknown>;
	const image = record['image'];
	if (image && typeof image === 'object') {
		const resolved = image as { assetId?: unknown; roles?: Record<string, Array<Record<string, unknown>>> };
		if (typeof resolved.assetId === 'string' && resolved.roles) {
			const list = into.get(resolved.assetId) ?? [];
			for (const [role, sources] of Object.entries(resolved.roles)) {
				for (const source of sources ?? []) {
					const url = typeof source['url'] === 'string' ? source['url'] : '';
					const key = url.includes('/media/') ? url.slice(url.indexOf('/media/') + 1) : '';
					const width = Number(source['width']);
					const height = Number(source['height']);
					if (!key || !Number.isInteger(width) || width <= 0) continue;
					if (list.some((row) => row.role === role && row.width === width)) continue;
					list.push({
						role,
						storageKey: key,
						width,
						height: Number.isInteger(height) && height > 0 ? height : Math.round((width * 4) / 3),
						byteSize: 0,
						format: 'image/webp',
						roleVersion: 1,
					});
				}
			}
			into.set(resolved.assetId, list);
		}
	}
	for (const value of Object.values(record)) collectDerivatives(value, into);
}

function photoAssets(derivatives: Map<string, ImageDerivative[]>): MediaAsset[] {
	return CATALOG_PHOTO_ASSET_IDS.map((id, index) => {
		const rows = derivatives.get(id) ?? [];
		const widest = [...rows].sort((a, b) => b.width - a.width)[0];
		return {
			id,
			kind: 'image' as const,
			purpose: 'product' as const,
			originalStorageKey: null,
			originalFormat: 'image/jpeg' as const,
			originalByteSize: 0,
			width: widest?.width ?? 1200,
			height: widest?.height ?? 1600,
			slug: `local-catalog-photo-${index + 1}`,
			derivatives: rows,
			dominantColor: '#d8cfc4',
			thumbHash: null,
			visibility: 'public' as const,
			processing: {
				state: 'ready' as const,
				attempts: 1,
				error: null,
				processedAt: '2026-11-03T00:00:00.000Z',
			},
			warnings: [],
			servesAsPrimary: false,
			maxDisplayWidth: null,
			renditions: [],
			hlsPlaylistKey: null,
			durationSeconds: null,
			text: {
				alt: { en: `Saha Textile product photo ${index + 1}` },
				title: {},
				caption: {},
			},
			status: 'live' as const,
			uploadedBy: null,
			deletedAt: null,
		};
	}).filter((asset) => asset.derivatives.length > 0);
}

/**
 * Maps the demo catalogue into the production collections.
 *
 * Every row in `products` is imported. The "Saha Textile" sentence is not a boundary.
 * Pictures are the three Spaces assets, rotated by product index. URLs are not copied
 * onto the product.
 */
export function mapDemoCatalogue(input: {
	products: DemoProduct[];
	attributes?: DemoAttributeMaster[];
}): DemoCatalogue {
	const products = [...input.products].sort((a, b) => a.id - b.id);
	const categories = new Map<number, DemoCategory>();
	for (const product of products) {
		for (const category of product.categories ?? []) categories.set(category.id, category);
	}

	const categorySlugs = new Set<string>();
	const categoryDocs: Category[] = [...categories.values()].map((category) => {
		const slugs = (category.canonical_path || category.slug || `category-${category.id}`).split('/');
		const pathIds = slugs.map((_, index) => {
			const prefix = slugs.slice(0, index + 1).join('/');
			const match = [...categories.values()].find((candidate) => candidate.canonical_path === prefix);
			return `cat_${match?.id ?? category.id}`;
		});
		return {
			id: `cat_${category.id}`,
			name: text(category.name, category.slug || `Category ${category.id}`),
			slug: claim(
				categorySlugs,
				slugify(category.slug || slugs.at(-1) || `category-${category.id}`),
				String(category.id),
			),
			parentId: pathIds.length > 1 ? pathIds[pathIds.length - 2]! : null,
			path: pathIds,
			ancestors: pathIds.slice(0, -1),
			depth: Math.max(0, slugs.length - 1),
			isBannerCollection: false,
			displayOrder: category.id,
		};
	});

	const placementPaths = new Set<string>();
	const placements: CategoryPlacement[] = [...categories.values()].flatMap((category) => {
		const slugs = (category.canonical_path || category.slug || `category-${category.id}`)
			.split('/')
			.map((part) => slugify(part));
		const pathCategoryIds = slugs.map((_, index) => {
			const prefix = (category.canonical_path || '')
				.split('/')
				.slice(0, index + 1)
				.join('/');
			const match = [...categories.values()].find((candidate) => candidate.canonical_path === prefix);
			return `cat_${match?.id ?? category.id}`;
		});
		const names = slugs.map((slug) => {
			const match = [...categories.values()].find((candidate) => candidate.slug === slug);
			return match?.name || slug;
		});
		const pathKey = slugs.join('/');
		if (placementPaths.has(pathKey)) return [];
		placementPaths.add(pathKey);
		return [
			{
				id: `plc_${slugs.join('_')}`,
				categoryId: `cat_${category.id}`,
				parentCategoryId: pathCategoryIds.length > 1 ? pathCategoryIds[pathCategoryIds.length - 2]! : null,
				pathCategoryIds,
				pathSlugs: slugs,
				pathLabel: names.join(' / '),
				depth: Math.max(0, slugs.length - 1),
				isCanonical: true,
				displayOrder: category.id,
				status: category.status === 0 ? 'draft' : 'live',
			},
		];
	});

	const definitions = new Map<string, AttributeDefinition>();
	const rememberAttribute = (attribute: DemoAttribute, drivesVariation: boolean, frames: readonly string[]) => {
		const code = slugify(attribute.slug || attribute.name || '');
		if (!code) return;
		const style = DISPLAY_STYLE[attribute.style ?? ''] ?? 'rectangle';
		const existing = definitions.get(code);
		const terms = (attribute.attribute_values ?? []).map((term, index) => {
			const label = term.value || term.slug || `Term ${index + 1}`;
			const hex =
				typeof term.hex_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(term.hex_color)
					? term.hex_color
					: undefined;
			return {
				code: slugify(term.slug || label),
				label: text(label, label),
				slug: slugify(term.slug || label),
				...(hex ? { hex } : {}),
				...(style === 'image_swatch' ? { swatchAssetId: frames[index % frames.length]! } : {}),
				aliases: [],
				isBase: isBaseLabel(label),
			};
		});
		if (!existing) {
			definitions.set(code, {
				id: `attr_${code}`,
				code,
				label: text(attribute.name, code),
				defaultRole: drivesVariation ? 'variation_axis' : 'filter_only',
				defaultDisplayStyle: style,
				valueType: style === 'color_swatch' ? 'color' : 'term',
				terms,
			});
			return;
		}
		const known = new Set(existing.terms.map((term) => term.code));
		existing.terms.push(...terms.filter((term) => !known.has(term.code)));
		if (drivesVariation) existing.defaultRole = 'variation_axis';
	};

	for (const attribute of input.attributes ?? []) rememberAttribute(attribute, false, CATALOG_PHOTO_ASSET_IDS);

	const skus = new Set<string>();
	const demoMeasurements: DemoMeasurement[] = [];
	const productDocs: Product[] = [];
	const variantDocs: ProductVariant[] = [];
	const measurementProducts: Product[] = [];

	products.forEach((product, index) => {
		const frames = catalogPhotoFrames(index);
		const id = `prd_${product.id}`;
		const slug = slugify(product.slug || product.name || `product-${product.id}`);
		const variable = (product.variations ?? []).length > 0;
		for (const attribute of product.attributes ?? []) rememberAttribute(attribute, variable, frames);
		const sku = claim(skus, product.sku || `SKU-${product.id}`, String(product.id));
		const price = rupee(product.price);
		const sale = rupee(product.sale_price);
		const onSale = sale > 0 && sale < price;
		const live = product.deleted_at
			? false
			: product.status === 1 || product.status === true || product.status === undefined;
		const categoryIds = (product.categories ?? []).map((category) => `cat_${category.id}`);
		const attributes = (product.attributes ?? [])
			.filter((attribute) => (attribute.attribute_values ?? []).length > 0)
			.map((attribute) => ({
				code: slugify(attribute.slug || attribute.name || 'axis'),
				label: text(attribute.name, attribute.slug || 'Attribute'),
				usedForVariations: variable,
				terms: (attribute.attribute_values ?? []).map((term, termIndex) => {
					const label = term.value || term.slug || `Term ${termIndex + 1}`;
					const hex =
						typeof term.hex_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(term.hex_color)
							? term.hex_color
							: undefined;
					const style = DISPLAY_STYLE[attribute.style ?? ''] ?? 'rectangle';
					return {
						code: slugify(term.slug || label),
						label: text(label, label),
						isBase: isBaseLabel(label),
						...(hex ? { hex } : {}),
						...(style === 'image_swatch' ? { swatch: frames[termIndex % frames.length]! } : {}),
					};
				}),
			}));
		const measurements = product.measurement_fields ?? product.bundle?.measurement_fields ?? [];
		if (measurements.length > 0 && demoMeasurements.length === 0) demoMeasurements.push(...measurements);
		const doc: Product = {
			id,
			type: variable ? 'variable' : 'simple',
			sku,
			title: text(product.name, slug),
			slug,
			description: product.description ? text(product.description, '') : undefined,
			categoryIds,
			tags: (product.tags ?? []).map((tag) => tag.slug || tag.name || '').filter(Boolean),
			basePriceINR: onSale ? sale : price,
			media: { gallery: [...frames] },
			attributes,
			optionGroups: optionGroupsFor(product, variable, frames),
			variations: [],
			addons: measurements.map((field) => ({
				code: slugify(field.code || field.label || 'measure'),
				label: text(field.label, field.code || 'Measurement'),
				type: 'number' as const,
				unit: field.unit === 'cm' ? 'cm' : 'in',
				required: false,
			})),
			relatedProductIds: [],
			crossSellIds: [],
			upsellIds: [],
			ratingsSummary: { avg: 0, count: 0 },
			status: live ? 'live' : 'draft',
			lifecycle: {
				liveAt: live ? (product.created_at ?? '2026-01-01T00:00:00.000Z') : null,
				disabledAt: null,
				discontinuedAt: null,
				richDataPurgedAt: null,
				statusReason: null,
			},
			madeToOrder: false,
			estimatedDeliveryText: product.estimated_delivery_text?.trim()
				? text(product.estimated_delivery_text, product.estimated_delivery_text)
				: null,
			lowStockThreshold: null,
			lifetimeUnitsReceived: 0,
			featured: Boolean(product.is_featured),
			insightBadges: [],
			pinnedBadges: [],
			hiddenBadges: [],
			backInStockAt: null,
			replacementTarget: null,
			addonTemplateCode: measurements.length > 0 ? 'blouse-measurements' : null,
			addonPriceINR: null,
			onSale,
			shippingDefaults: { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null },
			hsnCode: null,
			createdAt: product.created_at,
		};
		productDocs.push(doc);
		if (measurements.length > 0) measurementProducts.push(doc);

		const hashes = new Set<string>();
		const pushVariant = (
			variantId: string,
			rawSku: string,
			owner: string,
			selections: Array<{ attributeCode: string; termCode: string }>,
			amount: number,
			saleAmount: number | null,
			quantity: number,
			assetId: string,
			base: boolean,
		) => {
			let chosen = selections;
			let hash = hashOf(chosen);
			if (hashes.has(hash)) {
				chosen = [...selections, { attributeCode: 'row', termCode: slugify(owner) }];
				hash = hashOf(chosen);
			}
			hashes.add(hash);
			variantDocs.push({
				id: variantId,
				productId: id,
				sku: claim(skus, rawSku, owner),
				status: live ? 'live' : 'draft',
				optionSelections: chosen,
				optionSelectionHash: hash,
				isBaseVariant: base,
				priceINR: amount,
				compareAtPriceINR: saleAmount !== null ? amount : null,
				salePriceINR: saleAmount,
				stock: {
					tracked: true,
					quantity: Math.max(0, Math.round(quantity)),
					lowStockThreshold: null,
					allowBackorder: false,
				},
				media: { primaryAssetId: assetId },
			});
		};

		if (!variable) {
			pushVariant(
				`var_${product.id}_base`,
				sku,
				`${product.id}-base`,
				[{ attributeCode: 'item', termCode: 'single' }],
				price,
				onSale ? sale : null,
				product.quantity ?? 0,
				frames[0]!,
				true,
			);
			return;
		}

		(product.variations ?? []).forEach((variation, variationIndex) => {
			const amount = rupee(variation.price ?? product.price);
			const variantSale = rupee(variation.sale_price);
			const variantOnSale = variantSale > 0 && variantSale < amount;
			pushVariant(
				`var_${product.id}_${variation.id ?? variationIndex}`,
				variation.sku || `${sku}-${variationIndex + 1}`,
				String(variation.id ?? `${product.id}-${variationIndex}`),
				selectionsFor(variation, product.attributes ?? []),
				amount,
				variantOnSale ? variantSale : null,
				variation.quantity ?? 0,
				frames[variationIndex % frames.length]!,
				variationIndex === 0,
			);
		});
		const anySale = variantDocs.some((variant) => variant.productId === id && variant.salePriceINR !== null);
		doc.onSale = anySale || onSale;
		if (doc.onSale && !onSale) doc.basePriceINR = price;
	});

	const addonTemplates: AddonTemplate[] =
		measurementProducts.length && demoMeasurements.length
			? [
					{
						id: MEASUREMENT_TEMPLATE_ID,
						code: 'blouse-measurements',
						label: { en: 'Blouse measurements' },
						fields: demoMeasurements.map((field) => ({
							code: slugify(field.code || field.label || 'measure'),
							label: text(field.label, field.code || 'Measurement'),
							type: 'number' as const,
							unit: field.unit === 'cm' ? ('cm' as const) : ('in' as const),
							required: false,
							validation: {
								min: typeof field.min === 'number' ? field.min : 4,
								max: typeof field.max === 'number' ? field.max : 60,
								step: 0.5,
								decimals: 1,
							},
						})),
						status: 'active' as const,
					},
				]
			: [];

	for (const product of productDocs) {
		for (const group of product.optionGroups) {
			if (definitions.has(group.attributeCode)) continue;
			definitions.set(group.attributeCode, {
				id: `attr_${group.attributeCode}`,
				code: group.attributeCode,
				label: group.label,
				defaultRole: group.semanticRole,
				defaultDisplayStyle: group.displayStyle,
				valueType: 'term',
				terms: group.terms.map((term) => ({
					code: term.code,
					label: term.label,
					slug: term.code,
					aliases: [],
					isBase: term.isBase,
				})),
			});
		}
	}

	const bundleIds = new Set(products.filter((row) => row.type === 'bundle').map((row) => `prd_${row.id}`));
	const bundles: ProductBundle[] = productDocs
		.filter((product) => bundleIds.has(product.id))
		.flatMap((product) => {
			const components = productDocs.filter((candidate) => !bundleIds.has(candidate.id)).slice(0, 3);
			if (components.length === 0) return [];
			return [
				{
					id: `bnd_${product.id}`,
					productId: product.id,
					bundleType: 'choose_one_per_group' as const,
					pricePolicy: 'fixed_bundle_price' as const,
					fixedPriceINR: product.basePriceINR,
					groups: [
						{
							code: 'set',
							label: { en: 'Set' },
							minSelections: 1,
							maxSelections: 1,
							components: components.map((component) => ({
								productId: component.id,
								variantId: null,
								quantity: 1,
								required: false,
								priceAdjustmentINR: null,
							})),
						},
					],
					status: product.status,
				},
			];
		});

	const derivativeMap = new Map<string, ImageDerivative[]>();
	collectDerivatives(products, derivativeMap);

	return {
		categories: categoryDocs,
		placements,
		attributeDefinitions: [...definitions.values()],
		products: productDocs,
		variants: variantDocs,
		addonTemplates,
		bundles,
		photoAssets: photoAssets(derivativeMap),
	};
}
