import { describe, expect, it } from 'vitest';

import { slugOf } from './add-project';
import { keyPill } from './connections';

import type { KeyRef } from '@saha-textile/release-console-contracts';

const ref = (state: KeyRef['state']): KeyRef => ({
	id: 'do-read',
	kind: 'do-read',
	label: 'DigitalOcean API · read',
	keychainItem: 'P · do-read',
	account: '',
	rights: [],
	expiresAt: '2026-11-20T00:00:00.000Z',
	checkedAt: null,
	state,
	note: '',
});

describe('connections and wizard helpers', () => {
	it('words each key state as the brief does', () => {
		expect(keyPill(undefined)).toEqual({ cls: 'muted', text: 'not connected' });
		expect(keyPill(ref('verified')).cls).toBe('ok');
		expect(keyPill(ref('expiring'))).toEqual({ cls: 'amber', text: 'expires 2026-11-20' });
		expect(keyPill(ref('failed')).cls).toBe('red');
	});

	it('makes ids from names', () => {
		expect(slugOf('Client shop')).toBe('client-shop');
		expect(slugOf('  Saha Textile & Co. ')).toBe('saha-textile-co');
	});
});
