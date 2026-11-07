import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedThemePath = resolve(packageDirectory, '../developer-portal/src/css/nextgen-theme.css');
const adapterPath = resolve(packageDirectory, 'theme/adapter.css');
const outputDirectory = resolve(packageDirectory, '.generated');
const outputPath = resolve(outputDirectory, 'nextgen-typedoc.css');

const [sharedTheme, adapter] = await Promise.all([readFile(sharedThemePath, 'utf8'), readFile(adapterPath, 'utf8')]);

await mkdir(outputDirectory, { recursive: true });
await writeFile(
	outputPath,
	[
		'/* Generated from the shared portal theme plus the TypeDoc adapter. Do not edit. */',
		sharedTheme.trim(),
		adapter.trim(),
		'',
	].join('\n\n'),
	'utf8',
);

process.stdout.write(`Composed TypeDoc theme: ${outputPath}\n`);
