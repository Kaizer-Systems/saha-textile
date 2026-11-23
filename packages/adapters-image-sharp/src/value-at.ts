/**
 * The number at an index the caller's loop has already kept inside the array. A miss is a bug, so it fails loudly
 * here rather than counting as 0 and quietly skewing a measurement.
 */
export function valueAt(values: ArrayLike<number>, index: number): number {
	const value = values[index];
	if (value === undefined) throw new RangeError(`index ${index} is outside 0–${values.length - 1}`);
	return value;
}
