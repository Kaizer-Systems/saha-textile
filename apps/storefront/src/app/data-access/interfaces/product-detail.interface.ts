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
	| 'radio_bar';

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
	price_delta: number; // INR added to the base price
	image?: string;
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
	min?: number;
	max?: number;
}

/** A component consumed by a bundle/kit (own inventory + optional per-component options). */
export interface IBundleComponent {
	code: string;
	name: string;
	sku: string;
	image?: string;
	quantity: number;
	consumes: string; // e.g. '1 unit' | 'Service Slot'
	stock_status: string; // 'in_stock' | 'out_of_stock'
	stock?: number;
	price: number; // INR contribution shown in the snapshot
	attributes?: ISemanticAttribute[]; // descriptive (Color/Fabric …)
	requires_measurements?: boolean;
}

/** One choice inside a bundle option group. */
export interface IBundleOptionTerm {
	code: string;
	label: string;
	price_delta: number;
	image?: string;
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
}

/** A true bundle / composite / kit (KB `productBundles`). */
export interface IBundle {
	sku: string;
	bundle_type: 'fixed-kit' | 'choose-one-per-group' | 'optional-addons';
	price_policy: 'sum-components' | 'fixed-bundle-price' | 'discounted-components';
	bundle_price: number; // INR total shown
	components: IBundleComponent[];
	option_groups: IBundleOptionGroup[];
	measurement_fields?: IMeasurementField[];
	note?: string;
}
