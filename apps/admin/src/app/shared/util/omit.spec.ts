import { describe, expect, it } from 'vitest';

import { omit } from './omit';

describe('omit', () => {
	it('copies an object without the keys named, leaving the source as it was', () => {
		const term = { code: 'red', swatchAssetId: 'med_1', swatchVersionId: 'ver_1' };
		expect(omit(term, 'swatchAssetId', 'swatchVersionId')).toEqual({ code: 'red' });
		expect(term).toEqual({ code: 'red', swatchAssetId: 'med_1', swatchVersionId: 'ver_1' });
	});

	it('drops a key chosen at run time from a record, and a key that is not there changes nothing', () => {
		const labels: Record<string, string> = { en: 'Red', bn: 'লাল' };
		expect(omit(labels, 'bn')).toEqual({ en: 'Red' });
		expect(omit(labels, 'hi')).toEqual({ en: 'Red', bn: 'লাল' });
	});

	it('with no keys, gives a plain copy', () => {
		const row = { id: 'a' };
		const copy = omit(row);
		expect(copy).toEqual(row);
		expect(copy).not.toBe(row);
	});
});
