import { describe, expect, it } from 'vitest';

import { channelName, reachedShare } from './ops-screens';

describe('Jobs and Messages', () => {
	it('names channels plainly and counts what reached people', () => {
		expect(channelName('sms')).toBe('Texts (SMS)');
		expect(channelName('fax')).toBe('fax');
		expect(reachedShare({ total: 8, sent: 5, delivered: 1 })).toBe('75%');
		expect(reachedShare({ total: 0, sent: 0, delivered: 0 })).toBe('—');
	});
});
