import type { GoLiveGap, StoreLocation } from '@saha-textile/contracts';

const filled = (value: string | undefined): boolean => !!value && value.trim().length > 0;

const required = (field: string, values: Readonly<Record<string, string>> | undefined, locales: readonly string[]) =>
	locales.filter((locale) => !filled(values?.[locale])).map((locale) => ({ field, locale }));

/**
 * Everything that stops a store going active (stores brief, 2026-11-08): a name and an address in
 * every language, a landmark in every language once English has one, a phone number and at least
 * one open day. A store with no known phone or hours stays off the shop until they are entered.
 */
export function storeLocationGaps(
	store: Pick<StoreLocation, 'name' | 'address' | 'landmark' | 'phone' | 'hours'>,
	locales: readonly string[],
): GoLiveGap[] {
	const gaps: GoLiveGap[] = [
		...required('name', store.name, locales),
		...required('address', store.address, locales),
	];
	if (filled(store.landmark['en'])) gaps.push(...required('landmark', store.landmark, locales));
	if (!store.phone) gaps.push({ field: 'phone', locale: null });
	if (!store.hours.some((day) => day.open)) gaps.push({ field: 'hours', locale: null });
	return gaps;
}

/** The order the list and the shop use: display order, then English name, then id, so ties never shuffle. */
export function compareStoreLocations(
	a: Pick<StoreLocation, 'displayOrder' | 'name' | 'id'>,
	b: Pick<StoreLocation, 'displayOrder' | 'name' | 'id'>,
): number {
	return (
		a.displayOrder - b.displayOrder ||
		(a.name['en'] ?? '').localeCompare(b.name['en'] ?? '') ||
		a.id.localeCompare(b.id)
	);
}
