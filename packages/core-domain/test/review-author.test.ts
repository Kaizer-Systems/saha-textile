import { describe, expect, it } from 'vitest';

import { publicReviewerName } from '../src/catalog/review-author';

describe('publicReviewerName', () => {
	it('keeps the first name and the initial of the last', () => {
		expect(publicReviewerName('Riya Sen')).toBe('Riya S.');
		expect(publicReviewerName('  ananya   roy   chowdhury ')).toBe('ananya C.');
	});

	it('keeps a single name and empties a missing one', () => {
		expect(publicReviewerName('Moulik')).toBe('Moulik');
		expect(publicReviewerName('   ')).toBe('');
		expect(publicReviewerName(null)).toBe('');
		expect(publicReviewerName(undefined)).toBe('');
	});
});
