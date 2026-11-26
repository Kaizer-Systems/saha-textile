/**
 * The admin's dark mode as its own stylesheet.
 *
 * The admin theme writes dark mode by hand, as rules under `body.dark-only` (themes/_dark.scss, plus
 * small parts of _rtl.scss and _login.scss). Compiled with everything else, those rules were in the
 * one stylesheet every page downloads, light or dark, and some of them also changed sizes and
 * spacing. This module splits them out:
 *
 * - `withoutDarkRules` removes every `.dark-only` selector from the main stylesheet (Vite runs it
 *   on `src/styles.scss`), so light pages never download dark mode.
 * - `darkRulesOnly` keeps only those selectors, and of their declarations only colours,
 *   backgrounds, borders' colours and shadows. Dark mode then looks different but never moves
 *   anything: the same rule as the shop's `apps/storefront/scripts/build-dark-theme.mjs`.
 *
 * Plain JavaScript so the Vite config, the `styles` script and the tests share it.
 */
import postcss from 'postcss';

/** The class the theme's dark rules hang on (`body.dark-only`). */
export const DARK_CLASS = 'dark-only';

const DARK_TOKEN = new RegExp(`\\.${DARK_CLASS}(?![\\w-])`);

/** True when a single selector (no commas) only matches in dark mode. */
export const isDarkSelector = (selector) => DARK_TOKEN.test(selector);

/**
 * Properties dark mode may change: colours, backgrounds, borders' colours, shadows, colour variables,
 * and the paint-only effects the theme uses to recolour icons (`filter: invert(1)`) or dim pictures
 * (`opacity`). None of them moves or resizes anything.
 */
const PAINT =
	/color|^background|^border(?!-radius)(-(top|right|bottom|left))?$|^border-(top|right|bottom|left|inline|block)?-?color$|shadow|^fill$|^stroke$|^outline(-color)?$|text-stroke|^--|^caret-color$|^accent-color$|^color-scheme$|^(-webkit-)?filter$|^opacity$|blend-mode$/;

/** A shorthand's parts at the top level: `1px solid color-mix(in srgb, red 10%, #fff)` → 3 parts. */
function topLevelParts(value) {
	const parts = [];
	let depth = 0;
	let current = '';
	for (const character of value.trim()) {
		if (character === '(') depth++;
		if (character === ')') depth = Math.max(0, depth - 1);
		if (/\s/.test(character) && depth === 0) {
			if (current) parts.push(current);
			current = '';
		} else current += character;
	}
	if (current) parts.push(current);
	return parts;
}

const COLOUR_WORD = /^(transparent|currentcolor|white|black|red|inherit)$/i;
const COLOUR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\(/i;

/**
 * The colour inside a border shorthand (`1px solid #2a2d2d` → `#2a2d2d`), or null when it has none
 * (`2px dashed`). Whole functions are kept, however deeply they nest.
 */
export function colourOf(shorthand) {
	const colour = topLevelParts(shorthand).find(
		(part) => /^#[0-9a-f]{3,8}$/i.test(part) || COLOUR_WORD.test(part) || COLOUR_FUNCTION.test(part),
	);
	return colour ?? null;
}

/** Splits a rule's selector list into the selectors that only apply in dark mode and the rest. */
function partition(rule) {
	const dark = [];
	const light = [];
	for (const selector of rule.selectors) (isDarkSelector(selector) ? dark : light).push(selector);
	return { dark, light };
}

/** True inside `@keyframes`: animation frames are the same in both modes. */
const inKeyframes = (node) => {
	for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
		if (parent.type === 'atrule' && /keyframes$/.test(parent.name)) return true;
	}
	return false;
};

/** Drops at-rules (media queries, supports) left with nothing inside. */
function pruneEmpty(root) {
	let removed = true;
	while (removed) {
		removed = false;
		root.walkRules((rule) => {
			if (!rule.nodes?.length) {
				rule.remove();
				removed = true;
			}
		});
		root.walkAtRules((atRule) => {
			if (atRule.nodes && !atRule.nodes.length) {
				atRule.remove();
				removed = true;
			}
		});
	}
}

/** Removes every dark-only selector from a stylesheet, in place. Returns how many rules changed. */
export function withoutDarkRules(root) {
	let changed = 0;
	root.walkRules((rule) => {
		if (inKeyframes(rule)) return;
		const { dark, light } = partition(rule);
		if (!dark.length) return;
		changed++;
		if (light.length) rule.selectors = light;
		else rule.remove();
	});
	pruneEmpty(root);
	return changed;
}

/**
 * The dark rules alone, colour declarations only, as a new stylesheet. `report` collects what was
 * left out, so the `styles` script can say it.
 */
export function darkRulesOnly(css, report = { kept: new Map(), notColour: [] }) {
	const root = postcss.parse(css);
	root.walkComments((comment) => comment.remove());
	root.walkAtRules((atRule) => {
		// Font faces, animations and the charset are the same in both modes; the main stylesheet has them.
		if (/keyframes$/.test(atRule.name) || atRule.name === 'font-face' || atRule.name === 'charset') atRule.remove();
	});
	root.walkRules((rule) => {
		const { dark } = partition(rule);
		if (!dark.length) {
			rule.remove();
			return;
		}
		rule.selectors = dark;
		rule.walkDecls((decl) => {
			const where = `${rule.selector.replace(/\s+/g, ' ')} { ${decl.prop}: ${decl.value} }`;
			// Stopping an animation is fine too: the theme stops the sidebar's moving gradient in dark mode.
			const stops = /^animation(-name)?$/.test(decl.prop) && decl.value.trim() === 'none';
			if (!PAINT.test(decl.prop) && !stops) {
				// Same layout in both modes, whatever the theme's dark rule says.
				decl.remove();
				report.notColour.push(where);
				return;
			}
			// A border or outline shorthand also sets width and style, which can add pixels where the
			// light theme has no border. Dark mode only recolours it: a colour becomes that side's colour,
			// and `none` or `0` (the theme hiding a line in dark mode) becomes a transparent line of the
			// light theme's width.
			const shorthand = /^(border(-(top|right|bottom|left))?|outline)$/.exec(decl.prop);
			if (shorthand) {
				const hidden = /^(none|0|0px)$/i.test(decl.value.trim());
				const colour = hidden ? 'transparent' : colourOf(decl.value);
				if (!colour) {
					decl.remove();
					report.notColour.push(where);
					return;
				}
				decl.prop = `${decl.prop}-color`;
				decl.value = colour;
			}
			report.kept.set(decl.prop, (report.kept.get(decl.prop) ?? 0) + 1);
		});
	});
	pruneEmpty(root);
	const out = root.toString();
	// A browser drops everything after a syntax error without a word, so the build checks its own
	// output and fails instead (an unbalanced bracket once hid most of dark mode).
	postcss.parse(out);
	return out;
}

/**
 * Vite (PostCSS) plugin: takes the dark rules out of the admin's main stylesheet. Only the global
 * stylesheet: a component's own `:host-context(body.dark-only)` styles are small, scoped, and stay.
 */
export function stripDarkRules({ only = /src[\\/]styles\.scss$/ } = {}) {
	return {
		postcssPlugin: 'admin-strip-dark-rules',
		Once(root) {
			const file = root.source?.input.file ?? '';
			if (only.test(file)) withoutDarkRules(root);
		},
	};
}
stripDarkRules.postcss = true;
