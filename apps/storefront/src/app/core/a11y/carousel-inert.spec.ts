import { describe, expect, it } from 'vitest';

import { syncCarouselInert } from './carousel-inert';

describe('syncCarouselInert', () => {
	it('makes hidden slides inert and frees them again when they show', () => {
		const root = document.createElement('div');
		root.innerHTML = `
			<div class="owl-item" aria-hidden="true"><a href="/a">A</a></div>
			<div class="owl-item active"><a href="/b">B</a></div>`;
		syncCarouselInert(root);
		const [hidden, shown] = Array.from(root.querySelectorAll('.owl-item'));
		expect(hidden?.hasAttribute('inert')).toBe(true);
		expect(shown?.hasAttribute('inert')).toBe(false);
		hidden?.removeAttribute('aria-hidden');
		syncCarouselInert(root);
		expect(hidden?.hasAttribute('inert')).toBe(false);
	});
});
