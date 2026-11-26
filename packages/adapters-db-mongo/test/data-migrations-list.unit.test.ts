import { describe, expect, it, vi } from 'vitest';

import { DATA_MIGRATIONS } from '../src/release/data-migrations';

/** Each listed step hands over to its migration; the migrations themselves are tested on the database. */
const { calls, step } = vi.hoisted(() => {
	const calls: string[] = [];
	return { calls, step: (name: string) => async () => void calls.push(name) };
});

vi.mock('../src/migrations/bundles-v2', () => ({
	convertBundlesToLevels: step('convertBundlesToLevels'),
	seedBundlePriceMethods: step('seedBundlePriceMethods'),
	showProductsOnShop: step('showProductsOnShop'),
}));
vi.mock('../src/migrations/document-formats', () => ({ seedDocumentFormatsStep: step('seedDocumentFormatsStep') }));
vi.mock('../src/migrations/fx-launch-symbols', () => ({
	writeLaunchCurrencySymbols: step('writeLaunchCurrencySymbols'),
}));
vi.mock('../src/migrations/legal-pages', () => ({ seedLegalPages: step('seedLegalPages') }));
vi.mock('../src/migrations/order-number-format', () => ({
	setOwnerOrderNumberFormat: step('setOwnerOrderNumberFormat'),
}));
vi.mock('../src/migrations/orders-businesses-zones', () => ({
	prepareOrdersBusinessesAndZones: step('prepareOrdersBusinessesAndZones'),
}));
vi.mock('../src/migrations/mailbox-rights', () => ({ giveMailboxAccessRights: step('giveMailboxAccessRights') }));
vi.mock('../src/migrations/media-versions', () => ({
	addCardWidth600: step('addCardWidth600'),
	addProfileSizes: step('addProfileSizes'),
	addSwatchV2Width360: step('addSwatchV2Width360'),
	seedProfilesAndNameVersions: step('seedProfilesAndNameVersions'),
	widenProfileTypes: step('widenProfileTypes'),
}));
vi.mock('../src/migrations/shipping-premade', () => ({
	seedPremadeShippingRuleSets: step('seedPremadeShippingRuleSets'),
}));
vi.mock('../src/migrations/todays-home-page', () => ({ seedTodaysHomePage: step('seedTodaysHomePage') }));

describe('the release data migrations list', () => {
	it('runs each step’s own migration, in the listed order', async () => {
		for (const migration of DATA_MIGRATIONS) await migration.up();
		expect(calls).toEqual([
			'seedProfilesAndNameVersions',
			'addProfileSizes',
			'seedLegalPages',
			'widenProfileTypes',
			'seedTodaysHomePage',
			'addCardWidth600',
			'giveMailboxAccessRights',
			'seedPremadeShippingRuleSets',
			'writeLaunchCurrencySymbols',
			'prepareOrdersBusinessesAndZones',
			'setOwnerOrderNumberFormat',
			'addSwatchV2Width360',
			'seedBundlePriceMethods',
			'convertBundlesToLevels',
			'showProductsOnShop',
			'seedDocumentFormatsStep',
		]);
		expect(new Set(DATA_MIGRATIONS.map((row) => row.id)).size).toBe(DATA_MIGRATIONS.length);
	});
});
