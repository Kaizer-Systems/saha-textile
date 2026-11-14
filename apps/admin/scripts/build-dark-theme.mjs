#!/usr/bin/env node
/**
 * Writes the admin's dark stylesheet: the theme's `body.dark-only` rules, colour changes only.
 *
 *   node scripts/build-dark-theme.mjs <app.gen.css> <out.css>
 *
 * Run by the `styles` script after Sass has compiled `public/assets/scss/app.scss`. The page links
 * the result only in dark mode (`core/brand/theme-mode.ts`, `public/assets/js/theme-mode.js`); the
 * same rules are taken out of the main stylesheet by `stripDarkRules` in `vite.config.ts`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { darkRulesOnly } from './dark-theme.mjs';

const [inFile, outFile] = process.argv.slice(2);
if (!outFile) throw new Error('Usage: build-dark-theme.mjs <app.gen.css> <out.css>');

const report = { kept: new Map(), notColour: [] };
const css = darkRulesOnly(readFileSync(inFile, 'utf8'), report);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
	outFile,
	"/* Admin dark mode: colour changes only, built by scripts/build-dark-theme.mjs from the theme's " +
		'body.dark-only rules. Do not edit. */\n' +
		css +
		'\n',
);

const summary = [...report.kept.entries()].sort((a, b) => b[1] - a[1]);
console.log(
	`admin dark theme: kept ${summary.reduce((sum, [, count]) => sum + count, 0)} colour declarations, ` +
		`left out ${report.notColour.length} that would change layout`,
);
if (process.env['DARK_THEME_VERBOSE']) {
	console.log(summary.map(([prop, count]) => `  ${prop}: ${count}`).join('\n'));
	console.log(report.notColour.map((line) => `  - ${line}`).join('\n'));
}
