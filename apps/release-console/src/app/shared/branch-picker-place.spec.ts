import { describe, expect, it } from 'vitest';

import { floatingPlace } from './branch-picker';

describe('the floating branch list', () => {
	it('sits under its box, at most 320 px tall, and never past the window', () => {
		expect(floatingPlace({ top: 100, bottom: 140, left: 900, width: 280 }, 1000, 800)).toEqual({
			top: 144,
			bottom: null,
			left: 672,
			width: 320,
			maxHeight: 320,
		});
	});

	it('opens above its box when there is little room below', () => {
		const p = floatingPlace({ top: 600, bottom: 640, left: 100, width: 400 }, 1400, 760);
		expect(p.top).toBeNull();
		expect(p.bottom).toBe(164);
		expect(p.maxHeight).toBe(320);
	});
});
