#!/usr/bin/env node
/**
 * Builds the dark theme as colour changes only.
 *
 *   node scripts/build-dark-theme.mjs <light.css> <dark-copy.css> <out.css>
 *
 * The theme makes dark mode by compiling itself a second time with dark variables, every rule
 * under `.dark`. Loaded as it is, that copy also repeats every size, spacing and font rule, and
 * because `.dark x` outranks `x` it undoes the shop's own layout work wherever it differs from the
 * original theme (logo sizes, hero padding, footer plate). So this step keeps, for each rule, only
 * the declarations whose value differs from the light theme's value for the same selector in the
 * same media query. What is left is what dark mode is meant to change: colours, backgrounds,
 * borders, shadows. Nothing in the light theme is touched, and nothing is removed from it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import postcss from 'postcss';

const [lightFile, darkFile, outFile] = process.argv.slice(2);
if (!outFile) throw new Error('Usage: build-dark-theme.mjs <light.css> <dark-copy.css> <out.css>');

/** The at-rules around a node, e.g. `@media (max-width: 767px)`, as one key. */
function context(node) {
	const chain = [];
	for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
		if (parent.type === 'atrule') chain.unshift(`@${parent.name} ${parent.params}`);
	}
	return chain.join(' | ');
}

/** `.dark x` → `x`, `body.rtl .dark .x` → `body.rtl .x`: the light selector the dark one shadows. */
const lightSelector = (selector) =>
	selector
		.split(',')
		.map((part) =>
			part
				.trim()
				.replace(/(^|\s)\.dark(?=\s)\s*/, '$1')
				.trim(),
		)
		.join(', ');

/** Properties dark mode may change: colours, backgrounds, borders, shadows, and colour variables. */
const COLOUR =
	/color|^background|^border(?!-radius)(-(top|right|bottom|left))?$|^border-(top|right|bottom|left|inline|block)?-?color$|shadow|^fill$|^stroke$|^outline(-color)?$|text-stroke|^--/;

/** The colour inside a border shorthand (`1px solid #2a2d2d` → `#2a2d2d`), or null for `none`. */
function colourOf(shorthand) {
	const match =
		/(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|var\([^)]*\)|\b(transparent|currentcolor|white|black)\b)/i.exec(
			shorthand,
		);
	return match ? match[0] : null;
}

const value = (decl) => `${decl.value}${decl.important ? ' !important' : ''}`;

/**
 * Declared values per (media, selector), one entry per occurrence: the theme repeats some selectors
 * with different values, so the n-th dark rule is compared with the n-th light rule of that key.
 */
const light = new Map();
postcss.parse(readFileSync(lightFile, 'utf8')).walkRules((rule) => {
	if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
	const selector = rule.selectors.map((part) => part.trim()).join(', ');
	const key = `${context(rule)} :: ${selector}`;
	const values = new Map();
	rule.walkDecls((decl) => values.set(decl.prop, value(decl)));
	light.set(key, [...(light.get(key) ?? []), values]);
});
const occurrences = new Map();

const dark = postcss.parse(readFileSync(darkFile, 'utf8'));
const kept = new Map();
const unmatched = [];
const notColour = [];
let dropped = 0;
dark.walkAtRules((atRule) => {
	// Animations and font faces are the same in both modes; the light theme already has them.
	if (/keyframes$/.test(atRule.name) || atRule.name === 'font-face' || atRule.name === 'charset') atRule.remove();
});
dark.walkRules((rule) => {
	// The theme's demo confetti draws random sizes on every compile; it is not a dark-mode change.
	if (/\.confetti-\d/.test(rule.selector)) {
		rule.remove();
		return;
	}
	const key = `${context(rule)} :: ${lightSelector(rule.selectors.join(','))}`;
	const nth = occurrences.get(key) ?? 0;
	occurrences.set(key, nth + 1);
	const values = light.get(key)?.[nth];
	if (!values && rule.some((node) => node.type === 'decl')) unmatched.push(key);
	rule.walkDecls((decl) => {
		if (values?.get(decl.prop) === value(decl)) {
			decl.remove();
			dropped++;
		} else if (!COLOUR.test(decl.prop)) {
			// Same layout in both modes, whatever the theme's two copies say.
			decl.remove();
			notColour.push(`${rule.selector.replace(/\s+/g, ' ')} { ${decl.prop}: ${decl.value} }`);
		} else {
			// A border or outline shorthand would also set width and style, which can add pixels where
			// the light theme has no border. Dark mode only recolours it.
			const shorthand = /^(border(-(top|right|bottom|left))?|outline)$/.exec(decl.prop);
			if (shorthand) {
				const colour = colourOf(decl.value);
				if (!colour) {
					decl.remove();
					notColour.push(`${rule.selector.replace(/\s+/g, ' ')} { ${decl.prop}: ${decl.value} }`);
					return;
				}
				decl.prop = `${decl.prop}-color`;
				decl.value = colour;
			}
			kept.set(decl.prop, (kept.get(decl.prop) ?? 0) + 1);
		}
	});
	if (!rule.nodes.length) rule.remove();
});
// Comments and rules left empty, then media queries left empty once their rules are gone.
dark.walkComments((comment) => comment.remove());
dark.walkRules((rule) => {
	if (!rule.nodes.length) rule.remove();
});
// Media queries left empty once their rules are gone.
dark.walkAtRules((atRule) => {
	if (!atRule.nodes?.length) atRule.remove();
});

/**
 * The shop colour as text. `#417394` reads well on white but not on the dark theme's charcoal
 * (about 2.7 : 1), so every light rule that colours text or an icon with `var(--theme-color)` gets a
 * dark twin using a lighter tint of the same colour. The tint is worked out from `--theme-color`, so
 * it follows the Brand Kit colour. Backgrounds and borders keep the true colour: white text on it
 * already passes.
 */
const TINT = '--theme-text-on-dark';
const twins = postcss.root();
twins.append(
	postcss
		.rule({ selector: 'html.dark' })
		.append({ prop: TINT, value: 'color-mix(in srgb, var(--theme-color) 55%, #ffffff)' }),
);
let twinCount = 0;
postcss.parse(readFileSync(lightFile, 'utf8')).walkDecls(/^(color|fill)$/, (decl) => {
	if (!/^var\(--theme-color\)$/.test(decl.value.trim())) return;
	const rule = decl.parent;
	// Blue text on the rule's own white background stays blue: the white stays white in dark mode.
	const ownBackground = rule.nodes.find((node) => node.type === 'decl' && /^background(-color)?$/.test(node.prop));
	if (ownBackground && /#fff\b|#ffffff|\bwhite\b|rgb\(255, 255, 255\)/i.test(ownBackground.value)) return;
	if (rule.type !== 'rule' || (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name))) return;
	// Text over photographs keeps its light colours in dark mode (shop-dark.scss, D7).
	if (/home-contain|home-detail|banner-contain|banner-details/.test(rule.selector)) return;
	const selectors = rule.selectors
		.map((part) => part.trim())
		.filter((part) => !part.startsWith(':root'))
		.map((part) => (part.startsWith('html') ? part.replace(/^html(\.dark)?/, 'html.dark') : `.dark ${part}`));
	if (!selectors.length) return;
	const twin = postcss
		.rule({ selector: selectors.join(', ') })
		.append({ prop: decl.prop, value: `var(${TINT})`, important: decl.important });
	// Same media query as the light rule.
	let target = twins;
	const chain = [];
	for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
		if (parent.type === 'atrule') chain.unshift(parent);
	}
	for (const atRule of chain) {
		const wrapper = postcss.atRule({ name: atRule.name, params: atRule.params });
		target.append(wrapper);
		target = wrapper;
	}
	target.append(twin);
	twinCount++;
});

const header =
	'/* Dark theme: colour changes only, built by scripts/build-dark-theme.mjs from src/scss/dark.scss. Do not edit. */\n';
writeFileSync(outFile, header + dark.toString() + '\n' + twins.toString());
console.log(`shop colour as text: ${twinCount} rules use the lighter tint in dark mode`);
const summary = [...kept.entries()].sort((a, b) => b[1] - a[1]);
console.log(`dark theme: kept ${summary.reduce((sum, [, count]) => sum + count, 0)} declarations, dropped ${dropped}`);
console.log(summary.map(([prop, count]) => `  ${prop}: ${count}`).join('\n'));
if (notColour.length) console.log(`non-colour declarations left out: ${notColour.length}`);
if (unmatched.length)
	console.log(`dark rules with no light rule: ${unmatched.length}\n  ${unmatched.slice(0, 20).join('\n  ')}`);
