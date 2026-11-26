import { resolve } from 'node:path';

import postcss from 'postcss';
import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

import { colourOf, darkRulesOnly, isDarkSelector, stripDarkRules, withoutDarkRules } from './dark-theme.mjs';

const THEME = `
@charset "UTF-8";
@font-face { font-family: x; src: url(x.woff2); }
@keyframes spin { from { color: red } to { color: blue } }
body { color: #222; background-color: #f9f9f6; }
body.dark-only { color: rgba(255, 255, 255, 0.6); background-color: #0b141d; }
/* the theme's own comment */
body.dark-only .card { background-color: #1c2128; padding: 40px; border: 1px solid #1d3436; border-radius: 4px; }
body.dark-only .card-header { border-bottom: none; }
body.dark-only .tree li:after { filter: invert(0.4); opacity: 0.8; }
body.dark-only .sidebar { animation: none; }
body.dark-only .skeleton { animation: shimmer 1s; display: none; }
body.dark-only .divider { border-top: 2px dashed; }
.badge, body.dark-only .badge { color: #fff; }
.dark-only-ish { color: red; }
@media (max-width: 767px) { body.dark-only .menu { color: #c9d1d9; margin: 0; } .menu { margin: 4px; } }
@media (max-width: 575px) { body.dark-only .only-layout { width: 10px; } }
`;

describe('isDarkSelector', () => {
	it('matches the class as a whole word only', () => {
		expect(isDarkSelector('body.dark-only .x')).toBe(true);
		expect(isDarkSelector('[dir=rtl] body.dark-only')).toBe(true);
		expect(isDarkSelector('.dark-only-ish')).toBe(false);
		expect(isDarkSelector('body.light-only')).toBe(false);
	});
});

describe('colourOf', () => {
	it('finds the colour inside a shorthand', () => {
		expect(colourOf('1px solid #1d3436')).toBe('#1d3436');
		expect(colourOf('2px dashed rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.5)');
		expect(colourOf('1px solid var(--theme-color)')).toBe('var(--theme-color)');
		expect(colourOf('2px dashed')).toBeNull();
		expect(colourOf('none')).toBeNull();
	});

	it('keeps a nested colour function whole', () => {
		expect(colourOf('1px solid color-mix(in srgb, var(--theme-color) 10%, transparent)')).toBe(
			'color-mix(in srgb, var(--theme-color) 10%, transparent)',
		);
		expect(colourOf('1px dashed rgba(var(--theme-rgb), 0.5)')).toBe('rgba(var(--theme-rgb), 0.5)');
	});
});

describe('withoutDarkRules (the main stylesheet)', () => {
	it('drops dark selectors, keeps the light half of a mixed list, and prunes empty media', () => {
		const root = postcss.parse(THEME);
		expect(withoutDarkRules(root)).toBe(10);
		const css = root.toString();
		expect(css).not.toContain('dark-only ');
		expect(css).not.toMatch(/body\.dark-only[ ,{]/);
		expect(css).toContain('.badge { color: #fff; }');
		expect(css).toContain('.dark-only-ish');
		expect(css).toContain('.menu { margin: 4px; }');
		expect(css).not.toContain('575px');
		expect(css).toContain('@keyframes spin');
	});
});

describe('darkRulesOnly (the dark stylesheet)', () => {
	const report = { kept: new Map<string, number>(), notColour: [] as string[] };
	const css = darkRulesOnly(THEME, report);

	it('keeps only dark selectors, with their colours', () => {
		expect(css).toContain('body.dark-only { color: rgba(255, 255, 255, 0.6); background-color: #0b141d; }');
		expect(css).toContain('body.dark-only .badge { color: #fff; }');
		expect(css).not.toMatch(/(^|\n)\.badge/);
		expect(css).not.toContain('#f9f9f6');
		expect(css).not.toContain('dark-only-ish');
		expect(css).not.toContain('@font-face');
		expect(css).not.toContain('@keyframes');
		expect(css).not.toContain('@charset');
		expect(css).not.toContain('the theme');
	});

	it('leaves out anything that would move or resize, and says so', () => {
		expect(css).not.toMatch(/[{;]\s*(padding|border-radius|margin|display|width)\s*:/);
		expect(css).not.toContain('575px');
		expect(report.notColour).toEqual(
			expect.arrayContaining([
				'body.dark-only .card { padding: 40px }',
				'body.dark-only .skeleton { display: none }',
				'body.dark-only .skeleton { animation: shimmer 1s }',
				'body.dark-only .divider { border-top: 2px dashed }',
				'body.dark-only .only-layout { width: 10px }',
			]),
		);
	});

	it('turns borders into colours only, and a hidden line into a transparent one', () => {
		expect(css).toContain('border-color: #1d3436');
		expect(css).toContain('body.dark-only .card-header { border-bottom-color: transparent; }');
	});

	it('keeps paint-only effects and stopping an animation', () => {
		expect(css).toContain('filter: invert(0.4); opacity: 0.8;');
		expect(css).toContain('body.dark-only .sidebar { animation: none; }');
	});

	it('keeps media queries around dark rules that survive', () => {
		expect(css).toMatch(/@media \(max-width: 767px\) \{\s*body\.dark-only \.menu \{ color: #c9d1d9; \}/);
		expect(report.kept.get('color')).toBeGreaterThan(0);
	});
});

describe('stripDarkRules (Vite)', () => {
	const run = async (from: string) => (await postcss([stripDarkRules()]).process(THEME, { from })).css;

	it('cleans only the admin’s global stylesheet', async () => {
		expect(await run('/repo/apps/admin/src/styles.scss')).not.toContain('body.dark-only');
		// A component's own `:host-context(body.dark-only)` styles stay with the component.
		expect(await run('/repo/apps/admin/src/app/features/inbox/inbox.scss')).toContain('body.dark-only');
		expect(await run(undefined as unknown as string)).toContain('body.dark-only');
	});
});

describe('the real admin theme', () => {
	const scss = resolve(__dirname, '../public/assets/scss/app.scss');
	const theme = compile(scss, {
		loadPaths: [
			resolve(__dirname, '../public/assets/scss'),
			resolve(__dirname, '../node_modules'),
			resolve(__dirname, '../../../node_modules'),
		],
		quietDeps: true,
		logger: { warn: () => undefined, debug: () => undefined },
	}).css;
	const dark = darkRulesOnly(theme);
	const darkRoot = postcss.parse(dark);
	const declared = (selector: string, prop: string) => {
		let value: string | undefined;
		darkRoot.walkRules((rule) => {
			if (rule.selectors.includes(selector))
				rule.walkDecls(prop, (decl) => {
					value = decl.value;
				});
		});
		return value;
	};

	it('splits into a dark file with every dark rule intact', () => {
		let rules = 0;
		darkRoot.walkRules(() => {
			rules++;
		});
		expect(rules).toBeGreaterThan(1000);
		expect(declared('body.dark-only', 'background-color')).toBe('#0b141d');
		expect(declared('body.dark-only .page-wrapper .page-body-wrapper .page-body', 'background-color')).toBe(
			'#0b141d',
		);
	});

	it('leaves no dark rule in the main stylesheet', () => {
		const root = postcss.parse(theme);
		withoutDarkRules(root);
		expect(root.toString()).not.toMatch(/\.dark-only(?![\w-])/);
	});
}, 30_000);
