import { describe, expect, it } from 'vitest';

import { readRecentViews, rememberRecentView } from './recent-views';
import { readNotifyIntent, rememberNotifyIntent } from './notify-intent';

describe('recent views', () => {
	it('stores a slug and a time and nothing else', () => {
		const storage = new Map<string, string>();
		const memory = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
			removeItem: (key: string) => void storage.delete(key),
		} as Storage;
		rememberRecentView(memory, 'silk', 10);
		expect(readRecentViews(memory)).toEqual([{ slug: 'silk', at: 10 }]);
		expect(storage.get('st_recent')).not.toContain('price');
		expect(storage.get('st_recent')).not.toContain('email');
	});
});

describe('notify intent', () => {
	it('keeps a slug and a variant for 30 minutes and does not keep an email', () => {
		const storage = new Map<string, string>();
		const memory = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
			removeItem: (key: string) => void storage.delete(key),
		} as Storage;
		rememberNotifyIntent(memory, 'silk', 'SILK-1', 1_000);
		expect(readNotifyIntent(memory, 1_000 + 29 * 60_000)).toEqual({ slug: 'silk', variant: 'SILK-1' });
		expect(readNotifyIntent(memory, 1_000 + 31 * 60_000)).toBeNull();
		expect(storage.get('st_notify_intent')).not.toContain('email');
	});
});
