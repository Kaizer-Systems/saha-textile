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
	variation_id?: number | null;
	addon_selections?: Record<string, string>; // group code -> term code
	bundle_selections?: Record<string, string>; // group code -> term code
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

export interface ICart {
	id: number;
	product_id: number;
	variation: IVariation;
	variation_id: number | null;
	consumer_id?: number;
	quantity: number;
	sub_total: number;
	product: IProduct;
	/** Composed per-unit price (base + add-on/bundle deltas); falls back to variation/product sale price when absent. */
	unit_price?: number;
	line_config?: ICartLineConfig;
	created_by_id?: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}

export interface ICartAddOrUpdate {
	id: number | null;
	product: IProduct | null;
	product_id: number;
	variation: IVariation | null;
	variation_id: number | null;
	quantity: number;
	unit_price?: number;
	line_config?: ICartLineConfig;
}
