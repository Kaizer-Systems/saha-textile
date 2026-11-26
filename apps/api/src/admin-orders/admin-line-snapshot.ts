import type { AdminCartLine, OrderLine } from '@saha-textile/contracts';

/**
 * What an admin order line keeps of its options and add-ons, in the shape shop orders keep, so the order
 * page and the invoice read both the same way: every option as an attribute, every add-on with a price
 * (stitching) at the price charged, and the measurements as typed.
 */
export function adminLineConfig(
	line: Pick<AdminCartLine, 'options' | 'measurements'>,
): Pick<OrderLine, 'attributes' | 'addons'> {
	return {
		attributes: Object.fromEntries(line.options.map((option) => [option.group || option.code, option.value])),
		addons: [
			...line.options
				.filter((option) => option.listedPriceINR !== 0)
				.map((option) => ({
					code: option.code,
					label: option.group,
					value: option.value,
					priceINR: option.priceINR,
				})),
			...line.measurements.map((field) => ({ code: field.code, label: field.label, value: field.value })),
		],
	};
}
