import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
	GeoDataUnavailableError,
	ManifestGeoDataAdapter,
	folderGeoReader,
	geoObjectKey,
	storageGeoReader,
	type GeoManifest,
} from '../src/index';

const COUNTRIES = [
	{
		code: 'IN',
		name: 'India',
		callingCode: '91',
		mobileLengths: [10],
		postalCodeLabel: 'pin',
		postalCodePattern: '\\d{6}',
		postalCodeRequired: true,
		subdivisionLabel: 'state',
		hasSubdivisions: true,
	},
	{
		code: 'GB',
		name: 'United Kingdom',
		callingCode: '44',
		mobileLengths: [10],
		postalCodeLabel: 'postcode',
		postalCodePattern: '[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}',
		postalCodeRequired: true,
		subdivisionLabel: 'county',
		hasSubdivisions: true,
	},
];

/** A data folder and its manifest, as scripts/geo/build.mjs writes them. */
function fixture(withPins = true): { dir: string; manifest: GeoManifest } {
	const dir = mkdtempSync(join(tmpdir(), 'geo-'));
	const files: Record<string, string> = {
		'countries.json': JSON.stringify(COUNTRIES),
		'subdivisions/IN.json': JSON.stringify([{ code: 'WB', name: 'West Bengal', gstStateCode: '19' }]),
		'subdivisions/GB.json': JSON.stringify([{ code: 'KEN', name: 'Kent', gstStateCode: null }]),
	};
	if (withPins) {
		files['pins/700.json'] = JSON.stringify({
			'700029': { city: 'Kolkata', district: 'Kolkata', subdivisionCode: 'WB', gstStateCode: '19' },
		});
	}
	const entries: GeoManifest['files'] = {};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
		entries[path] = { sha256: createHash('sha256').update(text).digest('hex'), bytes: text.length };
	}
	return {
		dir,
		manifest: {
			schema: 1,
			version: 'test',
			counts: { countries: 2, withSubdivisions: 2, pins: withPins ? 1 : 0 },
			sources: {},
			files: entries,
		},
	};
}

describe('country, State, phone and PIN data from object storage (DEC-ADDRESS)', () => {
	it('lists countries, and gives one country its own States only', async () => {
		const { dir, manifest } = fixture();
		const read = vi.fn(folderGeoReader(dir));
		const geo = new ManifestGeoDataAdapter({ manifest, read });
		expect((await geo.countries()).find((row) => row.code === 'IN')).toMatchObject({ callingCode: '91' });
		const india = await geo.country('in');
		expect(india?.subdivisions).toEqual([expect.objectContaining({ name: 'West Bengal', gstStateCode: '19' })]);
		expect(await geo.country('ZZ')).toBeNull();
		// Only what was asked for is read, and each file once.
		await geo.countries();
		expect(read.mock.calls.map(([path]) => path).sort()).toEqual(['countries.json', 'subdivisions/IN.json']);
	});

	it('looks a PIN up in its own slice; "not loaded" while there is no PIN data', async () => {
		const { dir, manifest } = fixture();
		const read = vi.fn(folderGeoReader(dir));
		const geo = new ManifestGeoDataAdapter({ manifest, read });
		expect(await geo.pin('700029')).toMatchObject({ found: true, city: 'Kolkata', state: 'West Bengal' });
		expect(await geo.pin('999999')).toMatchObject({ found: false });
		expect(read.mock.calls.map(([path]) => path)).toContain('pins/700.json');
		const none = fixture(false);
		expect(await new ManifestGeoDataAdapter({ manifest: none.manifest, read: folderGeoReader(none.dir) }).pin('700029')).toBeNull();
	});

	it('refuses a file whose contents do not match the manifest, and tries again next time', async () => {
		const { dir, manifest } = fixture();
		const geo = new ManifestGeoDataAdapter({ manifest, read: async () => new TextEncoder().encode('[]') });
		await expect(geo.countries()).rejects.toBeInstanceOf(GeoDataUnavailableError);
		const fixed = new ManifestGeoDataAdapter({ manifest, read: folderGeoReader(dir) });
		expect((await fixed.countries()).length).toBe(2);
	});

	it('reads from storage by content hash', async () => {
		const { dir, manifest } = fixture();
		const keys: string[] = [];
		const local = folderGeoReader(dir);
		const byKey = new Map(Object.entries(manifest.files).map(([path, entry]) => [geoObjectKey(entry), path]));
		const geo = new ManifestGeoDataAdapter({
			manifest,
			read: storageGeoReader(async (key) => {
				keys.push(key);
				const path = byKey.get(key) as string;
				return local(path, manifest.files[path] as never);
			}),
		});
		await geo.countries();
		expect(keys).toEqual([`geo/${manifest.files['countries.json']?.sha256}.json`]);
	});

	it('checks mobile numbers with libphonenumber’s rules', async () => {
		const { dir, manifest } = fixture();
		const geo = new ManifestGeoDataAdapter({ manifest, read: folderGeoReader(dir) });
		expect(await geo.isValidMobile('91', '9830012345')).toBe(true);
		expect(await geo.isValidMobile('91', '98300123')).toBe(false);
		expect(await geo.mobileLengths('91')).toEqual([10]);
	});
});
