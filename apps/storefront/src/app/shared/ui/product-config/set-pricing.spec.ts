import { quoteBundle } from '@saha-textile/core-domain/bundle';
import { describe, expect, it } from 'vitest';

import { setQuote } from './set-pricing';
import { setBundle, setItem, setLevel } from './set-test-data';

describe('setQuote', () => {
	it('prices a fixed pair at its set price, against the pieces bought separately', () => {
		const pair = setBundle([setLevel('one', 1, [setItem('k', 26700)]), setLevel('two', 1, [setItem('a', 30000)])], {
			setPrice: 44900,
		});
		const quote = quoteBundle(setQuote(pair), {});
		expect(quote.totalINR).toBe(44900);
		expect(quote.separatelyINR).toBe(56700);
	});

	it('adds the difference for a dearer pick, prices extras, and counts metre lines per tenth', () => {
		const set = setBundle([setLevel('saree', 1, [setItem('b906', 19200), setItem('a1091', 28600)])], {
			setPrice: 18500,
		});
		set.extras = [
			setItem('pc', 0, { mrp: 450, today: 450 }),
			setItem('fabric', 400, { sold_by: 'metre', quantity: 25 }),
		];
		const engine = setQuote(set);
		expect(engine.extras[1]).toMatchObject({ perTenth: true });
		expect(quoteBundle(engine, { picks: { saree: ['a1091'] } }).totalINR).toBe(18500 + 9400);
		expect(quoteBundle(engine, { extras: ['pc', 'fabric'] }).totalINR).toBe(18500 + 1000);
	});
});
