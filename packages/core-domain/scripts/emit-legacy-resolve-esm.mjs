import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The package entry is CommonJS. Vite's SSR runner cannot evaluate that file.
 * This writes one ESM module for the address rules, from the typecheck output,
 * so the storefront imports the same functions without a second copy.
 */
const source = readFileSync(new URL('../dist/catalog/legacy-resolve.js', import.meta.url), 'utf8');
const body = source
	.replace(/^"use strict";\n/, '')
	.replace(/Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);\n/, '')
	.replace(/exports\.resolveLegacyAddress = resolveLegacyAddress;\n/, '')
	.replace(/exports\.collapseRedirectTarget = collapseRedirectTarget;\n/, '')
	.replace(/\n\/\/# sourceMappingURL=.*$/m, '');

writeFileSync(
	new URL('../dist/legacy-resolve.mjs', import.meta.url),
	`${body}\nexport { resolveLegacyAddress, collapseRedirectTarget };\n`,
);
