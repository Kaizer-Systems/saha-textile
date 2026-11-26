import type {
	ShippingAdjust,
	ShippingBandField,
	ShippingCondition,
	ShippingConditionField,
	ShippingConditionGroup,
	ShippingNode,
	ShippingOperator,
	ShippingResult,
	ShippingStep,
} from '@saha-textile/contracts';

/**
 * The rule builder's block factories and lists (brief rb04, rb05). Every block gets a short id the
 * server's checks and the builder's error marks point at.
 */

/** A short block id (`if-k3x9q2`), unique enough inside one rule set. */
export function blockId(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The fields a condition can read, grouped as the builder's menu shows them (rb04). */
export const FIELD_GROUPS: ReadonlyArray<{
	group: 'line' | 'cart' | 'delivery' | 'shopper';
	fields: ShippingConditionField[];
}> = [
	{
		group: 'line',
		fields: [
			'line.discounted',
			'line.quantity',
			'line.sellingPrice',
			'line.mrp',
			'line.discountPercent',
			'line.onSaleEvent',
			'line.category',
			'line.mainCategory',
			'line.product',
			'line.soldBy',
			'line.madeToOrder',
			'line.chargeableWeight',
			'line.charge.domestic',
			'line.charge.internationalFirst',
			'line.charge.internationalFurther',
		],
	},
	{
		group: 'cart',
		fields: ['cart.subtotal', 'cart.units', 'cart.lines', 'cart.chargeableWeight', 'cart.hasMadeToOrder'],
	},
	{ group: 'delivery', fields: ['delivery.country', 'delivery.state', 'delivery.pincode', 'delivery.zone'] },
	{ group: 'shopper', fields: ['shopper.signedIn', 'shopper.group', 'shopper.firstOrder'] },
];

export const BAND_FIELDS: readonly ShippingBandField[] = [
	'cart.chargeableWeight',
	'cart.subtotal',
	'cart.units',
	'cart.lines',
	'line.chargeableWeight',
	'line.quantity',
	'line.sellingPrice',
];

/** The translation key of a field's label: `line.charge.domestic` → `ship_f_line_charge_domestic`. */
export const fieldKey = (field: string): string => `ship_f_${field.replace(/\./g, '_')}`;
export const operatorKey = (op: ShippingOperator): string => `ship_op_${op}`;

export const newCondition = (): ShippingCondition => ({
	kind: 'condition',
	id: blockId('c'),
	field: null,
	op: null,
	value: null,
});

export const newGroup = (join: 'all' | 'any' = 'all'): ShippingConditionGroup => ({
	kind: 'group',
	id: blockId('g'),
	join,
	items: [newCondition()],
});

export type ResultKind = ShippingResult['kind'];

export function newResult(kind: ResultKind): ShippingResult {
	switch (kind) {
		case 'amount':
			return { kind, amount: null, per: 'once' };
		case 'percent':
			return { kind, percent: null, of: 'line' };
		case 'productCharge':
			return { kind, charge: 'domestic', per: 'unit' };
		case 'firstAndFurther':
			return {
				kind,
				first: { from: 'product', charge: 'internationalFirst' },
				further: { from: 'product', charge: 'internationalFurther' },
				count: 'acrossCart',
			};
		case 'free':
			return { kind };
		case 'cantShip':
			return { kind, message: {} };
		case 'courierQuote':
			return { kind };
	}
}

export type NodeKind = 'if' | 'bands' | ResultKind;

/** The "Add a block" menu (rb05): decisions and results that can sit in a branch. */
export const NODE_MENU: ReadonlyArray<{ group: 'decisions' | 'charges'; kinds: NodeKind[] }> = [
	{ group: 'decisions', kinds: ['if', 'bands'] },
	{
		group: 'charges',
		kinds: ['amount', 'productCharge', 'firstAndFurther', 'percent', 'free', 'cantShip', 'courierQuote'],
	},
];

export function newNode(kind: NodeKind): ShippingNode {
	if (kind === 'if') return { kind: 'if', id: blockId('if'), when: newGroup('all'), then: null, otherwise: null };
	if (kind === 'bands') {
		return {
			kind: 'bands',
			id: blockId('bands'),
			field: 'cart.chargeableWeight',
			bands: [{ id: blockId('band'), from: 0, to: null, then: null }],
			otherwise: null,
		};
	}
	return { kind: 'result', id: blockId('r'), result: newResult(kind) };
}

export const newStep = (scope: ShippingStep['scope'] = 'eachLine'): ShippingStep => ({
	id: blockId('step'),
	scope,
	node: null,
	combine: 'sum',
});

export function newAdjust(kind: ShippingAdjust['kind']): ShippingAdjust {
	switch (kind) {
		case 'minimum':
			return { kind, id: blockId('min'), amount: null };
		case 'maximum':
			return { kind, id: blockId('max'), amount: null };
		case 'roundUp':
			return { kind, id: blockId('round'), to: null };
		case 'freeAbove':
			return { kind, id: blockId('free'), subtotal: null };
	}
}

/** A copy of a step with every block id renewed, for Duplicate. */
export function duplicateStep(step: ShippingStep): ShippingStep {
	const renew = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(renew);
		if (value && typeof value === 'object') {
			const copy: Record<string, unknown> = {};
			for (const [key, inner] of Object.entries(value))
				copy[key] =
					key === 'id' && typeof inner === 'string' ? blockId(inner.split('-')[0] || 'b') : renew(inner);
			return copy;
		}
		return value;
	};
	return renew(step) as ShippingStep;
}
