import { ApiImage, galleryAttachment } from '@core/catalog/from-api';
import {
	CartLineProblem,
	ICart,
	ICartAddOrUpdate,
	ICartChild,
	ICartLineConfig,
} from '@data-access/interfaces/cart.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';

interface ApiCartOption {
	code: string;
	termCode: string;
	group: string;
	value: string;
	priceDeltaINR: number;
}

export interface ApiCartLine {
	id: string;
	productId: string;
	slug: string;
	title: string;
	image: ApiImage | null;
	sku: string;
	variationId: string | null;
	variantLabel: string | null;
	quantity: number;
	available: number | null;
	soldBy?: 'piece' | 'metre';
	shortestCutTenths?: number | null;
	basePriceINR: number;
	unitPriceINR: number;
	mrpINR: number | null;
	lineTotalINR: number;
	options: ApiCartOption[];
	measurements: { code: string; label: string; value: number; unit: string }[];
	problem: CartLineProblem | null;
	bundle?: SetChoiceRaw | null;
	free?: { productId: string; variantId: string | null }[];
	children?: ApiCartChild[];
	setHeading?: 'components' | 'choose' | null;
}

type SetChoiceRaw = NonNullable<NonNullable<ICartLineConfig['raw']>['set_choice']>;

interface ApiCartChild {
	role: 'piece' | 'free' | 'extra';
	key: string;
	parentKey: string | null;
	level: string | null;
	productId: string;
	title: string;
	sku: string;
	image: ApiImage | null;
	variantLabel: string | null;
	quantity: number;
	priceINR: number;
	mrpINR: number | null;
}

export interface ApiCartView {
	id: string | null;
	lines: ApiCartLine[];
	subtotalINR: number;
	count: number;
}

/** What a shopper chose, as the API wants it. Prices are never sent. */
export interface CartLineChoice {
	variationId: string | null;
	addons: { code: string; value: string | number }[];
	/** A set's choices (bundle builder brief); absent for other products. */
	bundle?: SetChoiceRaw;
	/** A product's own free items (P8). */
	free?: { productId: string; variantId: string | null }[];
}

/** Null for a plain line, which has nothing to show and nothing to edit. */
function lineConfig(line: ApiCartLine): ICartLineConfig | undefined {
	const { variantLabel, options, measurements } = line;
	const free = line.free ?? [];
	// A set or a product with free items is edited in the pop-up too (brief E02: "Change").
	const chosen = !!line.bundle || free.length > 0 || (line.children ?? []).some((child) => child.role === 'free');
	if (!variantLabel && !options.length && !measurements.length && !chosen) return undefined;
	return {
		variation_label: variantLabel ?? undefined,
		addon_options: options.map(({ group, value, priceDeltaINR }) => ({ group, value, price_delta: priceDeltaINR })),
		measurements: measurements.map(({ label, value, unit }) => ({ label, value, unit })),
		base_price: line.basePriceINR,
		delta_total: line.unitPriceINR - line.basePriceINR,
		raw: {
			variation_id: line.variationId,
			addon_selections: Object.fromEntries(options.map((option) => [option.code, option.termCode])),
			measurements: Object.fromEntries(measurements.map((row) => [row.code, row.value])),
			...(line.bundle ? { set_choice: line.bundle } : {}),
			...(chosen ? { free_items: free } : {}),
		},
	};
}

function childItem(child: ApiCartChild): ICartChild {
	return {
		role: child.role,
		key: child.key,
		parent_key: child.parentKey,
		product_id: child.productId,
		title: child.title,
		sku: child.sku,
		image_url: child.image ? galleryAttachment(child.image, 0).original_url : null,
		variant_label: child.variantLabel,
		quantity: child.quantity,
		price: child.priceINR,
		mrp: child.mrpINR,
	};
}

/** The server's line in the shape the cart screens already read. */
export function cartItem(line: ApiCartLine): ICart {
	const mrp = line.mrpINR ?? line.basePriceINR;
	const discount = mrp > line.basePriceINR ? Math.floor(((mrp - line.basePriceINR) / mrp) * 100) : 0;
	const product = {
		id: line.productId,
		slug: line.slug,
		name: line.title,
		sku: line.sku,
		price: mrp,
		sale_price: line.basePriceINR,
		discount,
		product_thumbnail: line.image ? galleryAttachment(line.image, 0) : undefined,
	} as unknown as IProduct;
	const variation = line.variationId
		? ({
				id: line.variationId,
				name: line.variantLabel ?? '',
				sku: line.sku,
				price: mrp,
				sale_price: line.basePriceINR,
				quantity: line.available ?? line.quantity,
				attribute_values: [],
				selected_variation: line.variantLabel ?? '',
			} as unknown as IVariation)
		: null;
	return {
		id: line.id,
		product_id: line.productId,
		product,
		variation: variation as IVariation,
		variation_id: line.variationId,
		quantity: line.quantity,
		unit_price: line.unitPriceINR,
		sub_total: line.lineTotalINR,
		line_config: lineConfig(line),
		children: (line.children ?? []).map(childItem),
		set_heading: line.setHeading ?? null,
		problem: line.problem,
		available: line.available,
		sold_by: line.soldBy ?? 'piece',
		shortest_cut_tenths: line.shortestCutTenths ?? null,
	};
}

/** Reads the choice out of what the configurator built. */
export function lineChoice(payload: ICartAddOrUpdate): CartLineChoice {
	const raw = payload.line_config?.raw;
	const picked = { ...raw?.addon_selections, ...raw?.bundle_selections, ...raw?.measurements };
	return {
		variationId: payload.variation_id == null ? null : String(payload.variation_id),
		addons: Object.entries(picked).map(([code, value]) => ({ code, value })),
		...(raw?.set_choice ? { bundle: raw.set_choice } : {}),
		...(raw?.free_items ? { free: raw.free_items } : {}),
	};
}
