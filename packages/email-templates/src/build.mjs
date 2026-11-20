#!/usr/bin/env node
/**
 * Writes the registrable source of every template to dist/<name>_v1.html, with the per-environment
 * `[[tokens]]` kept, after checking each against MSG91's Handlebars subset and our email rules.
 * Stops with every problem listed when a template fails. Run: pnpm --filter @saha-textile/email-templates build
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { checkTemplate } from './check.mjs';
import { TEMPLATES, render } from './templates.mjs';

const out = join(import.meta.dirname, '..', 'dist');
await mkdir(out, { recursive: true });
const problems = [];
for (const template of TEMPLATES) {
	const source = render(template);
	problems.push(
		...checkTemplate(template.name, source),
		...checkTemplate(`${template.name} subject`, template.subject),
	);
	await writeFile(join(out, `${template.name}_v1.html`), source);
}
if (problems.length) {
	console.error(problems.join('\n'));
	process.exitCode = 1;
} else {
	console.log(`${TEMPLATES.length} templates written to dist/`);
}
