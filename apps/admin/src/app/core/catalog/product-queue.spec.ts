import { describe, expect, it } from 'vitest';

import { nextInProductQueue, rememberProductQueue } from './product-queue';

const memory = () => {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
	} as unknown as Storage;
};

describe('product queue', () => {
	it('names the next product after the current one, and none at the end', () => {
		const storage = memory();
		rememberProductQueue(storage, ['p1', 'p2', 'p3']);
		expect(nextInProductQueue(storage, 'p1')).toBe('p2');
		expect(nextInProductQueue(storage, 'p3')).toBeNull();
		expect(nextInProductQueue(storage, 'other')).toBeNull();
		expect(nextInProductQueue(storage, undefined)).toBeNull();
	});

	it('copes with no storage, a broken value and a refusing store', () => {
		expect(nextInProductQueue(null, 'p1')).toBeNull();
		const storage = memory();
		storage.setItem('st_admin_product_queue', '{oops');
		expect(nextInProductQueue(storage, 'p1')).toBeNull();
		storage.setItem('st_admin_product_queue', '{"a":1}');
		expect(nextInProductQueue(storage, 'p1')).toBeNull();
		const refusing = {
			setItem: () => {
				throw new Error('full');
			},
		} as unknown as Storage;
		expect(() => rememberProductQueue(refusing, ['p1'])).not.toThrow();
		rememberProductQueue(null, ['p1']);
	});
});
