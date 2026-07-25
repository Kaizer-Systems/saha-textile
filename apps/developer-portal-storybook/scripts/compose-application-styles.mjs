import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageDirectory, '../..');
const outputDirectory = resolve(packageDirectory, '.generated');
const storefrontRequire = createRequire(resolve(repositoryRoot, 'apps/storefront/package.json'));

const storefrontStylePaths = [
	storefrontRequire.resolve('bootstrap/dist/css/bootstrap.min.css'),
	storefrontRequire.resolve('ngx-toastr/toastr'),
	storefrontRequire.resolve('swiper/css'),
	storefrontRequire.resolve('swiper/swiper-bundle.css'),
	resolve(repositoryRoot, 'apps/storefront/src/scss/app.gen.css'),
	resolve(repositoryRoot, 'apps/storefront/src/scss/theme-color.css'),
];

const storefrontParts = await Promise.all(
	storefrontStylePaths.map(async (path) => `/* Source: ${path} */\n${await readFile(path, 'utf8')}`),
);

const sass = await import('sass');
const adminEntryPoint = resolve(repositoryRoot, 'apps/admin/public/assets/scss/app.scss');
const adminResult = sass.compile(adminEntryPoint, {
	loadPaths: [
		resolve(repositoryRoot, 'apps/admin/public/assets/scss'),
		resolve(repositoryRoot, 'apps/admin/node_modules'),
		resolve(repositoryRoot, 'node_modules'),
	],
	silenceDeprecations: ['color-functions', 'global-builtin', 'if-function', 'import'],
	style: 'compressed',
});

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
	writeFile(
		resolve(outputDirectory, 'storefront.css'),
		`/* Generated from storefront application style sources. Do not edit. */\n${storefrontParts.join('\n\n')}\n`,
		'utf8',
	),
	writeFile(
		resolve(outputDirectory, 'admin.css'),
		`/* Generated from admin application style sources. Do not edit. */\n${adminResult.css}\n`,
		'utf8',
	),
]);

process.stdout.write(`Composed Storybook application styles: ${outputDirectory}\n`);
