/**
 * Tailoring measurements. Each field stores one unit. A shopper may look at the
 * other unit; the value that is kept is snapped to that field's step first.
 */

export type MeasurementUnit = 'in' | 'cm';

/** Exact enough for a half-inch blouse measurement. Not a stored rate. */
const CM_PER_INCH = 2.54;

function decimalPlaces(step: number): number {
	if (step >= 1) return 0;
	const text = step.toString();
	const dot = text.indexOf('.');
	return dot === -1 ? 0 : text.length - dot - 1;
}

export function snapToStep(value: number, step: number): number {
	if (!(step > 0) || !Number.isFinite(value)) throw new RangeError('step must be positive and value finite');
	const snapped = Math.round(value / step) * step;
	return Number(snapped.toFixed(decimalPlaces(step)));
}

export function convertMeasurement(value: number, from: MeasurementUnit, to: MeasurementUnit, step: number): number {
	if (from === to) return snapToStep(value, step);
	const converted = from === 'in' ? value * CM_PER_INCH : value / CM_PER_INCH;
	return snapToStep(converted, step);
}

export function measurementInRange(value: number, min: number | undefined, max: number | undefined): boolean {
	if (min !== undefined && value < min) return false;
	if (max !== undefined && value > max) return false;
	return true;
}
