import { IProduct, IVariation } from './product.interface';

export interface ICartModel {
	items: ICart[];
	total?: number;
}

/**
 * Readable snapshot of a composed line's configuration (variation + add-on /
 * bundle selections + measurements + price breakdown) so the cart views can
 * render complex products without re-deriving anything. Populated by the PDP.
 */
export interface ICartConfigOption {
	group: string; // e.g. "Blouse Design"
	value: string; // e.g. "Design 1"
	price_delta: number; // INR added by this choice
}

export interface ICartConfigComponent {
	name: string;
	sku: string;
	price: number; // INR contribution
}

export interface ICartConfigMeasurement {
	label: string;
	value: number;
	unit: string;
}

/**
 * Raw selection snapshot for loss-less edit round-trip. The readable arrays above
 * are for display; these code/value maps let the config modal re-seed the exact
 * same selections when a cart line is re-opened for editing.
 */
export interface ICartConfigRaw {
	variation_id?: number | string | null;
	addon_selections?: Record<string, string>; // group code -> term code
	bundle_selections?: Record<string, string>; // group code -> term code
	/** A set's choices: picks per level, sizes, extras and free items per piece (bundle builder brief). */
	set_choice?: {
		picks: Record<string, string[]>;
		variants: Record<string, string>;
		extras: string[];
		free: Record<string, { productId: string; variantId: string | null }[]>;
	};
	/** A product's own free items picked (P8). */
	free_items?: { productId: string; variantId: string | null }[];
	measurements?: Record<string, number>; // field code -> value
}

export interface ICartLineConfig {
	variation_label?: string; // human-readable variant, e.g. "Green" or "Green / M"
	addon_options?: ICartConfigOption[];
	bundle_options?: ICartConfigOption[];
	bundle_components?: ICartConfigComponent[];
	measurements?: ICartConfigMeasurement[];
	base_price: number; // per-unit base incl. selected variation / bundle kit price
	delta_total: number; // sum of add-on + bundle option deltas (per unit)
	raw?: ICartConfigRaw; // machine-readable snapshot for edit prefill (not displayed)
}

export type CartLineProblem = 'unavailable' | 'out_of_stock' | 'limited' | 'below_shortest_cut';

/**
 * What a line holds beneath it (bundle builder brief E02–E04): a set's pieces at their share of the set price, a
 * piece's free items, the set's extras, or a product's own free items. Quantities are per one set or product.
 */
export interface ICartChild {
	role: 'piece' | 'free' | 'extra';
	key: string;
	/** The piece a free item comes with; null for extras and a product's own free items. */
	parent_key: string | null;
	product_id: string;
	title: string;
	sku: string;
	image_url: string | null;
	variant_label: string | null;
	quantity: number;
	/** The piece's share, an extra's price, or 0 for a free item. */
	price: number;
	mrp: number | null;
}

export interface ICart {
	id: string;
	product_id: number | string;
	variation: IVariation;
	variation_id: number | string | null;
	consumer_id?: number;
	quantity: number;
	sub_total: number;
	product: IProduct;
	/** Composed per-unit price (base + add-on/bundle deltas); falls back to variation/product sale price when absent. */
	unit_price?: number;
	line_config?: ICartLineConfig;
	/** A set's pieces, free items and extras, or a product's free items (bundle builder brief E02). */
	children?: ICartChild[];
	/** A set's heading on the shop; absent for other products. */
	set_heading?: 'components' | 'choose' | null;
	/** Why this line cannot be bought as it stands. */
	problem?: CartLineProblem | null;
	/** Units that can be bought now. Null means no limit. */
	available?: number | null;
	/** Fabric by the metre: `quantity` and `available` are tenths of a metre, the price is per metre. */
	sold_by?: 'piece' | 'metre';
	/** The least this line may be cut to, in tenths; null for pieces. */
	shortest_cut_tenths?: number | null;
	created_by_id?: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}

export interface ICartAddOrUpdate {
	id: string | null;
	product: IProduct | null;
	product_id: number | string;
	variation: IVariation | null;
	variation_id: number | string | null;
	quantity: number;
	unit_price?: number;
	line_config?: ICartLineConfig;
}
