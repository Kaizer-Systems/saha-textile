import { describe, expect, it } from 'vitest';

import { lowPriorityScripts } from './script-priority.vite';

describe('application scripts at low fetch priority', () => {
	const built = [
		'<link rel="preload" href="/assets/fonts/text/public-sans.woff2" as="font" crossorigin>',
		'<script type="module" crossorigin src="/assets/index-Ab12.js"></script>',
		'<link rel="modulepreload" crossorigin href="/assets/chunk-Cd34.js">',
		'<link rel="stylesheet" href="/assets/index-Ef56.css">',
		'<script type="module">import("/x.js")</script>',
		'<script>window.inline = 1</script>',
	].join('\n');

	it('lowers the entry script and every module preload', () => {
		const out = lowPriorityScripts(built);
		expect(out).toContain('<script fetchpriority="low" type="module" crossorigin src="/assets/index-Ab12.js">');
		expect(out).toContain(
			'<link fetchpriority="low" rel="modulepreload" crossorigin href="/assets/chunk-Cd34.js">',
		);
	});

	it('leaves fonts, stylesheets and inline scripts as they are', () => {
		const out = lowPriorityScripts(built);
		expect(out).toContain('<link rel="preload" href="/assets/fonts/text/public-sans.woff2" as="font" crossorigin>');
		expect(out).toContain('<link rel="stylesheet" href="/assets/index-Ef56.css">');
		expect(out).toContain('<script type="module">import("/x.js")</script>');
		expect(out).toContain('<script>window.inline = 1</script>');
	});

	it('never adds a second priority, so running twice changes nothing', () => {
		const once = lowPriorityScripts(built);
		expect(lowPriorityScripts(once)).toBe(once);
		const own = '<link rel="modulepreload" fetchpriority="high" href="/a.js">';
		expect(lowPriorityScripts(own)).toBe(own);
	});
});
