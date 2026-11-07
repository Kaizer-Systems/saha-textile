import { ApiImage, galleryAttachment } from '@core/catalog/from-api';
import {
	CartLineProblem,
	ICart,
	ICartAddOrUpdate,
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
	basePriceINR: number;
	unitPriceINR: number;
	mrpINR: number | null;
	lineTotalINR: number;
	options: ApiCartOption[];
	measurements: { code: string; label: string; value: number; unit: string }[];
	problem: CartLineProblem | null;
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
}

/** Null for a plain line, which has nothing to show and nothing to edit. */
function lineConfig(line: ApiCartLine): ICartLineConfig | undefined {
	const { variantLabel, options, measurements } = line;
	if (!variantLabel && !options.length && !measurements.length) return undefined;
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
		},
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
		problem: line.problem,
		available: line.available,
	};
}

/** Reads the choice out of what the configurator built. */
export function lineChoice(payload: ICartAddOrUpdate): CartLineChoice {
	const raw = payload.line_config?.raw;
	const picked = { ...raw?.addon_selections, ...raw?.bundle_selections, ...raw?.measurements };
	return {
		variationId: payload.variation_id == null ? null : String(payload.variation_id),
		addons: Object.entries(picked).map(([code, value]) => ({ code, value })),
	};
}
