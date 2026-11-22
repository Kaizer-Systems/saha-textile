/**
 * PDP semantic-role model (KB §03/§04).
 *
 * The backend decides an option group's BEHAVIOUR via `semanticRole`
 * (`variation_axis` | `filter_only` | `named_add_on` | `bundle_component_option`)
 * and its LOOK via `displayStyle` — the two are independent. The storefront only
 * consumes these; it never infers behaviour from the visual style.
 *
 * These are optional additions on top of the existing Fastkart `IProduct`
 * shape, so legacy/simple products are unaffected:
 *   - variation_axis  -> existing `attributes[]` + generated `variations[]`
 *   - filter_only     -> `semantic_attributes[]` (display-only pills + info rows)
 *   - named_add_on    -> `addon_groups[]` (+ conditional `measurement_fields`)
 *   - bundle          -> `bundle` (composite/kit)
 */
import type { IVariation } from './product.interface';
import type { CatalogPageBundle } from '@saha-textile/contracts';

/**
 * Single display-style vocabulary (key: `style`) for ALL option renderers —
 * variation axes AND add-on/bundle groups. Theme values render via the theme's
 * variant styles; `image_tile` and `radio_bar` are the only genuinely-new looks
 * we added (add-on tile with name+price+check, and the add-on long-bar radio).
 * Behaviour is a separate dimension (`semantic_role`), never encoded here.
 */
export type DisplayStyle =
	| 'color'
	| 'image'
	| 'rectangle'
	| 'circle'
	| 'radio'
	| 'dropdown'
	| 'image_tile'
	| 'radio_bar'
	// The four looks from the early renders (owner, 21 Nov 2026, product page brief P6).
	| 'picture_row'
	| 'picture_chip'
	| 'size_v2'
	| 'colour_chip';

/** The looks drawn by the shared `.st-look` item in `scss/components/_option-looks.scss`. */
export const LOOKS_FROM_RENDERS: readonly DisplayStyle[] = ['picture_row', 'picture_chip', 'size_v2', 'colour_chip'];

/** Looks that show each value's picture, so a value without its own takes its variant's photo. */
export const PICTURE_LOOKS: readonly string[] = ['image', 'picture_row', 'picture_chip'];

export type SemanticRole = 'variation_axis' | 'filter_only' | 'named_add_on' | 'bundle_component_option';

/**
 * A `filter_only` attribute: descriptive metadata that feeds category/search
 * facets and is shown on the PDP as a pill + Product-Information row ONLY. It
 * never changes SKU/stock/price and is not selectable.
 */
export interface ISemanticAttribute {
	code: string;
	label: string; // static label key or dynamic value; rendered as-is for now
	value: string;
	icon?: string; // remixicon class, e.g. 'ri-palette-line'
}

/** One choice inside a named add-on group (e.g. a specific blouse design). */
export interface IAddonTerm {
	code: string;
	label: string;
	/** Optional second line under the name (`size_v2`), in the page language. */
	sub_label?: string;
	price_delta: number; // INR added to the base price
	image?: string;
	/** The value's colour, for the colour looks. */
	hex?: string;
	is_default?: boolean;
	requires_measurements?: boolean;
}

/**
 * A `named_add_on` group (e.g. "Blouse Design"). Customises an included
 * sub-part; does NOT generate a variation matrix. Snapshotted on the cart line.
 */
export interface IAddonGroup {
	code: string;
	label: string;
	help_text?: string;
	required: boolean;
	style: DisplayStyle;
	default_term_code?: string;
	terms: IAddonTerm[];
}

/** A tailoring measurement input (Shoulder/Chest/Waist/Sleeve …). */
export interface IMeasurementField {
	code: string;
	label: string;
	unit: string; // 'in' | 'cm'
	step?: number;
	min?: number;
	max?: number;
}

/** A size or colour a shopper picks for a set piece or a free item (S8). */
export interface IChoiceVariant {
	id: string;
	label: string;
	in_stock: boolean;
}

/** A free item the shopper picked (or was given), with the size they chose when it has sizes. */
export interface IFreePick {
	productId: string;
	variantId: string | null;
}

/** One free item on offer (P8). */
export interface IFreeItem {
	product_id: string;
	name: string;
	image?: string;
	mrp: number | null;
	selling: number;
	quantity: number;
	in_stock: boolean;
	variant_id: string | null;
	variant_label: string | null;
	variants: IChoiceVariant[];
}

/** Free with this product (P8, D4/D5): given, or a choice of how many. Worked out by core `freeRange`. */
export interface IFreeWith {
	take: 'all' | 'exactly' | 'upto' | 'between';
	count: number | null;
	from: number | null;
	required: boolean;
	given: boolean;
	min: number;
	max: number;
	none_or_exactly: boolean;
	items: IFreeItem[];
}

/** One item of a set level or an optional extra, with today's prices and stock. */
export interface ISetItem {
	key: string;
	product_id: string;
	slug: string;
	name: string;
	sku: string;
	image?: string;
	mrp: number | null;
	selling: number;
	/** The running sale's price, while a sale lowers it. */
	sale: number | null;
	/** Price in this set, per unit. */
	price_in_set: number;
	/** What one unit costs bought alone today. */
	today: number;
	quantity: number;
	sold_by: 'piece' | 'metre';
	in_stock: boolean;
	available: number | null;
	variant_id: string | null;
	variant_label: string | null;
	variants: IChoiceVariant[];
	free_with: IFreeWith | null;
}

/** A set level: fixed (holds no more than it takes) or a choice. */
export interface ISetLevel {
	code: string;
	label: string;
	take: number;
	choice: boolean;
	price_mode: 'difference' | 'included' | 'own';
	items: ISetItem[];
}

/** One choice inside a bundle option group. */
export interface IBundleOptionTerm {
	code: string;
	label: string;
	sub_label?: string;
	price_delta: number;
	image?: string;
	hex?: string;
	is_default?: boolean;
	requires_measurements?: boolean;
}

/** A "choose your bundle options" group (e.g. Blouse Design / Petticoat Size). */
export interface IBundleOptionGroup {
	code: string;
	label: string;
	required: boolean;
	style: DisplayStyle;
	default_term_code?: string;
	terms: IBundleOptionTerm[];
}

/**
 * State a configurator (add-on group / bundle) reports up to the buy-box so it
 * can show the running total and gate Add-to-Cart. Also the shape the PDP will
 * hand to the cart line when cart is finalised (KB: variation + add-ons +
 * measurements + resolved components + price breakdown).
 */
export interface ConfiguratorState {
	total: number; // final price incl. deltas (INR)
	delta: number; // amount added over the base price
	valid: boolean; // required selections made + measurements filled where needed
	selections?: Record<string, string>; // groupCode -> termCode
	measurements?: Record<string, number>;
	/** A set: each level's picked items, the extras ticked, and every piece it now holds. */
	picks?: Record<string, string[]>;
	extras?: string[];
	pieces?: string[];
	/** A set: the size or colour chosen for each item without a pinned one. */
	variants?: Record<string, string>;
	/** A set: the free items picked for each piece that brings a choice (D5). */
	free?: Record<string, IFreePick[]>;
	/** A product: its free items picked (P8). */
	free_items?: IFreePick[];
}

/**
 * Composed snapshot the shared `ProductConfigurator` reports to whichever host
 * renders it (PDP buy-box or the config modal). Lets the host render the price
 * header and gate Add-to-Cart without re-deriving anything from the sections.
 */
export interface IConfiguratorSummary {
	displayPrice: number; // headline per-unit price (selected variant / bundle kit / base)
	comparePrice: number; // struck-through price when discounted
	discount: number; // % off
	unitPrice: number; // displayPrice + add-on/bundle deltas (what the cart charges)
	purchasable: boolean; // every present section satisfied
	soldOut: boolean; // genuinely out of stock (not merely un-configured)
	hasFilterAttrs: boolean;
	hasVariation: boolean;
	hasAddon: boolean;
	hasBundle: boolean;
	variation: IVariation | null; // the variant the shopper has picked, if any
}

/**
 * A set (bundle builder brief, approved 2026-11-22): levels, optional extras and how it is priced. The shop prices
 * every choice with core `quoteBundle` from `pricing`, the same rules checkout uses.
 */
export interface IBundle {
	sku: string;
	heading: 'components' | 'choose';
	/** The set at its included picks, without extras. */
	bundle_price: number;
	separately: number;
	save: number;
	from_price: boolean;
	low: number;
	high: number;
	levels: ISetLevel[];
	extras: ISetItem[];
	/** As the API sends it; read by `setQuote`. */
	pricing: ISetPricing;
	stock: {
		sets_possible: number;
		state: 'in_stock' | 'low_stock' | 'out_of_stock';
		sold_out_pieces: string[];
		sold_out_choices: string[];
	};
	/** Live, in stock and inside its sale window. */
	buyable: boolean;
	option_groups: IBundleOptionGroup[];
	measurement_fields?: IMeasurementField[];
	note?: string;
}

/** A set's price method and rules, in the shape core's engine reads (camelCase, as the API sends it). */
export type ISetPricing = CatalogPageBundle['pricing'];

/** A measurement template's size table. Numbers are in each field's own unit. */
export interface ISizeGuide {
	fields: { code: string; label: string; unit: 'in' | 'cm' }[];
	rows: { size: string; values: Readonly<Record<string, number>> }[];
}
