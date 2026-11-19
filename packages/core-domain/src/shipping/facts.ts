import type {
	ShippingCartSnapshot,
	ShippingChargeKind,
	ShippingConditionField,
	ShippingSnapshotLine,
	ShippingZone,
} from '@saha-textile/contracts';

/**
 * The facts a condition or a band reads. Line facts describe one line (or, in a unit loop, one
 * unit of it); cart facts always describe the whole cart; delivery and shopper facts come from
 * the checkout.
 */

/** How a field's value is compared; it decides which operators and values are allowed. */
export type ShippingFieldType = 'boolean' | 'number' | 'money' | 'percent' | 'grams' | 'id' | 'text' | 'pincode';

export const SHIPPING_FIELD_TYPES: Readonly<Record<ShippingConditionField, ShippingFieldType>> = {
	'line.discounted': 'boolean',
	'line.quantity': 'number',
	'line.sellingPrice': 'money',
	'line.mrp': 'money',
	'line.discountPercent': 'percent',
	'line.onSaleEvent': 'boolean',
	'line.category': 'id',
	'line.mainCategory': 'id',
	'line.product': 'id',
	'line.soldBy': 'text',
	'line.madeToOrder': 'boolean',
	'line.chargeableWeight': 'grams',
	'line.charge.domestic': 'money',
	'line.charge.internationalFirst': 'money',
	'line.charge.internationalFurther': 'money',
	'cart.subtotal': 'money',
	'cart.units': 'number',
	'cart.lines': 'number',
	'cart.chargeableWeight': 'grams',
	'cart.hasMadeToOrder': 'boolean',
	'delivery.country': 'text',
	'delivery.state': 'text',
	'delivery.pincode': 'pincode',
	'delivery.zone': 'text',
	'shopper.signedIn': 'boolean',
	'shopper.group': 'text',
	'shopper.firstOrder': 'boolean',
};

/** True for the fields that need a line or unit loop. */
export const isLineField = (field: string): boolean => field.startsWith('line.');

/** A price below MRP by more than rounding noise: the owner's "discounted" (sale events included). */
export function isDiscounted(line: Pick<ShippingSnapshotLine, 'sellingPriceINR' | 'mrpINR' | 'basePriceINR'>): boolean {
	return line.mrpINR !== null && line.mrpINR - (line.basePriceINR ?? line.sellingPriceINR) > 0.004;
}

export function discountPercent(
	line: Pick<ShippingSnapshotLine, 'sellingPriceINR' | 'mrpINR' | 'basePriceINR'>,
): number {
	if (line.mrpINR === null || line.mrpINR <= 0 || !isDiscounted(line)) return 0;
	return ((line.mrpINR - (line.basePriceINR ?? line.sellingPriceINR)) / line.mrpINR) * 100;
}

export function chargeFor(line: ShippingSnapshotLine, kind: ShippingChargeKind): number {
	return line.charges[kind];
}

/** The whole-cart facts, worked out once per pricing. */
export interface ShippingCartFacts {
	subtotalINR: number;
	units: number;
	lines: number;
	chargeableWeightGrams: number;
	hasMadeToOrder: boolean;
	/** Lines with no weight or box at all; weight rules count them as 0 g, so the overview warns. */
	linesWithoutWeight: string[];
}

export function cartFacts(snapshot: ShippingCartSnapshot): ShippingCartFacts {
	let subtotal = 0;
	let units = 0;
	let grams = 0;
	const linesWithoutWeight: string[] = [];
	for (const line of snapshot.lines) {
		subtotal += line.sellingPriceINR * line.units;
		units += line.units;
		if (line.chargeableWeightGrams === null) linesWithoutWeight.push(line.lineId);
		else grams += line.chargeableWeightGrams * line.units;
	}
	return {
		subtotalINR: subtotal,
		units,
		lines: snapshot.lines.length,
		chargeableWeightGrams: grams,
		hasMadeToOrder: snapshot.lines.some((line) => line.madeToOrder),
		linesWithoutWeight,
	};
}

/** What one evaluation looks at: the cart, the zone, and the line or unit in hand (if any). */
export interface ShippingEvalScope {
	snapshot: ShippingCartSnapshot;
	cart: ShippingCartFacts;
	zone: ShippingZone;
	line: ShippingSnapshotLine | null;
	/** Units the line facts count: the line's units, or 1 in a unit loop. */
	lineUnits: number;
}

export type ShippingFactValue = boolean | number | string | string[] | null;

/** The value of a field in a scope; null when the field needs a line and there is none. */
export function factValue(field: ShippingConditionField, scope: ShippingEvalScope): ShippingFactValue {
	const { line, cart, snapshot } = scope;
	switch (field) {
		case 'cart.subtotal':
			return cart.subtotalINR;
		case 'cart.units':
			return cart.units;
		case 'cart.lines':
			return cart.lines;
		case 'cart.chargeableWeight':
			return cart.chargeableWeightGrams;
		case 'cart.hasMadeToOrder':
			return cart.hasMadeToOrder;
		case 'delivery.country':
			return snapshot.delivery.country.toUpperCase();
		case 'delivery.state':
			return snapshot.delivery.state;
		case 'delivery.pincode':
			return snapshot.delivery.pincode;
		case 'delivery.zone':
			return scope.zone;
		case 'shopper.signedIn':
			return snapshot.shopper.signedIn;
		case 'shopper.group':
			return snapshot.shopper.groups;
		case 'shopper.firstOrder':
			return snapshot.shopper.firstOrder;
		default:
			break;
	}
	if (line === null) return null;
	switch (field) {
		case 'line.discounted':
			return isDiscounted(line);
		case 'line.quantity':
			return scope.lineUnits;
		case 'line.sellingPrice':
			return line.sellingPriceINR;
		case 'line.mrp':
			return line.mrpINR;
		case 'line.discountPercent':
			return discountPercent(line);
		case 'line.onSaleEvent':
			return line.onSaleEvent;
		case 'line.category':
			return line.categoryIds;
		case 'line.mainCategory':
			return line.mainCategoryId;
		case 'line.product':
			return line.productId;
		case 'line.soldBy':
			return line.soldBy;
		case 'line.madeToOrder':
			return line.madeToOrder;
		case 'line.chargeableWeight':
			return (line.chargeableWeightGrams ?? 0) * scope.lineUnits;
		case 'line.charge.domestic':
			return line.charges.domestic;
		case 'line.charge.internationalFirst':
			return line.charges.internationalFirst;
		case 'line.charge.internationalFurther':
			return line.charges.internationalFurther;
	}
	return null;
}
