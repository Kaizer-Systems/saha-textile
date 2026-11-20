import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileGeoDataAdapter } from '../src/index';

const geo = new FileGeoDataAdapter();

describe('country, State and phone data (DEC-ADDRESS)', () => {
	it('lists countries with their calling code and mobile lengths', async () => {
		const india = (await geo.countries()).find((row) => row.code === 'IN');
		expect(india).toMatchObject({
			callingCode: '91',
			postalCodeLabel: 'pin',
			postalCodePattern: '\\d{6}',
			mobileLengths: [10],
		});
	});

	it('gives India its States with GST codes, and the UK its counties', async () => {
		const india = await geo.country('in');
		expect(india?.subdivisions.find((row) => row.name === 'West Bengal')).toMatchObject({ gstStateCode: '19' });
		expect(india?.subdivisions.every((row) => row.gstStateCode)).toBe(true);
		const uk = await geo.country('GB');
		expect(uk?.subdivisions.some((row) => row.name === 'Kent')).toBe(true);
		expect(await geo.country('ZZ')).toBeNull();
	});

	it('checks mobile numbers with libphonenumber’s rules', async () => {
		expect(await geo.isValidMobile('91', '9830012345')).toBe(true);
		expect(await geo.isValidMobile('91', '98300123')).toBe(false);
		expect(await geo.isValidMobile('44', '7911123456')).toBe(true);
	});

	it('answers "not loaded" for PINs until the directory exists, then looks them up', async () => {
		const empty = mkdtempSync(join(tmpdir(), 'geo-'));
		writeFileSync(join(empty, 'countries.json'), '[]');
		expect(await new FileGeoDataAdapter(empty).pin('700029')).toBeNull();
		writeFileSync(
			join(empty, 'india-pins.json'),
			JSON.stringify({
				'700029': { city: 'Kolkata', district: 'Kolkata', subdivisionCode: 'WB', gstStateCode: '19' },
			}),
		);
		const loaded = new FileGeoDataAdapter(empty);
		expect(await loaded.pin('700029')).toMatchObject({ found: true, city: 'Kolkata', gstStateCode: '19' });
		expect(await loaded.pin('999999')).toMatchObject({ found: false });
	});
});
