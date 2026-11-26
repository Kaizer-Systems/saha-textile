import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MediaBrowseQuery, MediaSelection, MediaZipRequest, ShareLinkCreate } from '../src/media-library';

const problems = (schema: z.ZodType, value: unknown): string[] => {
	const result = schema.safeParse(value);
	return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('the Media page rules', () => {
	it('reads the categories filter from an address list or an array, and showWithout from the address', () => {
		expect(MediaBrowseQuery.parse({ categories: 'images,,videos' }).categories).toEqual(['images', 'videos']);
		expect(MediaBrowseQuery.parse({ categories: ['documents'] }).categories).toEqual(['documents']);
		for (const on of [true, 'true', '1'])
			expect(MediaBrowseQuery.parse({ showWithout: on }).showWithout).toBe(true);
		for (const off of [false, 'false', '0']) {
			expect(MediaBrowseQuery.parse({ showWithout: off }).showWithout).toBe(false);
		}
	});

	it('a selection and a zip download need at least one file or folder', () => {
		for (const schema of [MediaSelection, MediaZipRequest]) {
			expect(problems(schema, { fileIds: ['f1'] })).toEqual([]);
			expect(problems(schema, { folderIds: ['d1'] })).toEqual([]);
			expect(problems(schema, {})).toEqual(['nothing chosen']);
		}
	});

	it('a share link ending on a date names the date, and an admins-only link takes no password', () => {
		expect(problems(ShareLinkCreate, { expiry: '7d', password: 'secret' })).toEqual([]);
		expect(problems(ShareLinkCreate, { expiry: 'date', expiresAt: '2026-12-31T00:00:00.000Z' })).toEqual([]);
		expect(problems(ShareLinkCreate, { expiry: 'date' })).toEqual(['a date is needed']);
		expect(problems(ShareLinkCreate, { expiry: 'never', who: 'admins' })).toEqual([]);
		expect(problems(ShareLinkCreate, { expiry: 'never', who: 'admins', password: 'secret' })).toEqual([
			'admins-only links take no password',
		]);
	});
});
