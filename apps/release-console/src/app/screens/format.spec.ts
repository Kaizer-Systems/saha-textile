import { describe, expect, it } from 'vitest';

import { formatBytes } from './format';

describe('formatBytes', () => {
	it('uses binary units like Docker', () => {
		expect(formatBytes(327680000)).toBe('312.5 MB');
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(16 * 1024 ** 3)).toBe('16.0 GB');
		expect(formatBytes(null)).toBe('—');
	});
});
