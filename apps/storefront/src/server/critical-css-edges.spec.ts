import { describe, expect, it } from 'vitest';

import { criticalKey, pageShape, sampleBody, samplesDocument } from './critical-css';

const LINKS = [{ tag: '<link rel="stylesheet" href="/a.css">', href: '/a.css' }];

describe('critical CSS helpers: the edges', () => {
	it('keys a collection page by its language, its query left out', () => {
		expect(criticalKey('/bn/collections/sarees?page=2', LINKS)).toBe('collection:bn|/a.css|fixed');
	});

	it('samples a page with no body tags as a whole, its scripts removed', () => {
		expect(sampleBody('<main>x</main><script>boot()</script>')).toBe('<main>x</main>');
		expect(sampleBody('<body class="x"><main>y</main>')).toBe('<main>y</main>');
	});

	it('reads a bare class attribute and extra spaces between class names', () => {
		expect([...pageShape('<body><div class><p class="  a   b ">t</p></body>')]).toEqual([
			'div',
			'@class',
			'p',
			'.a',
			'.b',
		]);
	});

	it('builds the samples document from a page without a body tag', () => {
		expect(samplesDocument('<p>x</p>', ['<i>1</i>', '<i>2</i>'])).toBe('<p>x</p><i>1</i>\n<i>2</i></body></html>');
	});
});
