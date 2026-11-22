import { describe, expect, it } from 'vitest';

import { isBuilderMessage } from './bundle-preview';

describe('isBuilderMessage', () => {
	const event = (origin: string, data: unknown) => ({ origin, data }) as MessageEvent;
	it("takes only the builder's own messages, from the admin origin", () => {
		expect(
			isBuilderMessage(
				event('https://admin.test', { type: 'st-bundle-preview', name: 'Set', bundle: null }),
				'https://admin.test',
			),
		).toBe(true);
		expect(
			isBuilderMessage(
				event('https://evil.test', { type: 'st-bundle-preview', name: 'Set', bundle: null }),
				'https://admin.test',
			),
		).toBe(false);
		expect(
			isBuilderMessage(event('https://admin.test', { type: 'other', name: 'Set' }), 'https://admin.test'),
		).toBe(false);
		expect(isBuilderMessage(event('https://admin.test', null), 'https://admin.test')).toBe(false);
	});
});
