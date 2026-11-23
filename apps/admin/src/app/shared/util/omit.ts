/**
 * A copy of an object without the keys named. The source is left as it was. It replaces destructuring a key into a
 * variable that is then never read, only to leave it out of the rest.
 */
export function omit<T extends object, K extends keyof T>(source: T, ...keys: readonly K[]): Omit<T, K> {
	const copy: Partial<T> = { ...source };
	for (const key of keys) delete copy[key];
	return copy as Omit<T, K>;
}
