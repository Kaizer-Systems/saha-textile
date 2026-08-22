import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Emit application CSS the same way the storefront/admin `styles` scripts do, then
// concatenate. This child does not compile Sass through a portal-specific
// silenceDeprecations list. Bootstrap/Fastkart deprecations stay in those pipelines.

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageDirectory, '../..');
const outputDirectory = resolve(packageDirectory, '.generated');
const storefrontRequire = createRequire(resolve(repositoryRoot, 'apps/storefront/package.json'));
const sassCli = resolve(dirname(storefrontRequire.resolve('sass')), 'sass.js');

const storefrontEntry = resolve(repositoryRoot, 'apps/storefront/src/scss/app.scss');
const storefrontGenerated = resolve(repositoryRoot, 'apps/storefront/src/scss/app.gen.css');
const adminEntry = resolve(repositoryRoot, 'apps/admin/public/assets/scss/app.scss');
const adminGenerated = resolve(repositoryRoot, 'apps/admin/public/assets/scss/app.gen.css');

function compileStylesheet(entry, output, loadPaths) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(
			process.execPath,
			[
				sassCli,
				'--quiet',
				'--quiet-deps',
				'--no-source-map',
				...loadPaths.flatMap((loadPath) => ['--load-path', loadPath]),
				`${entry}:${output}`,
			],
			{ cwd: repositoryRoot, stdio: 'inherit' },
		);
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			rejectPromise(new Error(`sass ${entry} failed with ${signal ? `signal ${signal}` : `exit ${code}`}`));
		});
	});
}

await compileStylesheet(storefrontEntry, storefrontGenerated, [
	resolve(repositoryRoot, 'apps/storefront/node_modules'),
	resolve(repositoryRoot, 'node_modules'),
]);
await compileStylesheet(adminEntry, adminGenerated, [
	resolve(repositoryRoot, 'apps/admin/public/assets/scss'),
	resolve(repositoryRoot, 'apps/admin/node_modules'),
	resolve(repositoryRoot, 'node_modules'),
]);

const storefrontStylePaths = [
	storefrontRequire.resolve('bootstrap/dist/css/bootstrap.min.css'),
	storefrontRequire.resolve('ngx-toastr/toastr'),
	storefrontRequire.resolve('swiper/css'),
	storefrontRequire.resolve('swiper/swiper-bundle.css'),
	storefrontGenerated,
	resolve(repositoryRoot, 'apps/storefront/src/scss/theme-color.css'),
];

const storefrontParts = await Promise.all(
	storefrontStylePaths.map(async (path) => `/* Source: ${path} */\n${await readFile(path, 'utf8')}`),
);
const adminCss = await readFile(adminGenerated, 'utf8');

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
	writeFile(
		resolve(outputDirectory, 'storefront.css'),
		`/* Generated from storefront application style sources. Do not edit. */\n${storefrontParts.join('\n\n')}\n`,
		'utf8',
	),
	writeFile(
		resolve(outputDirectory, 'admin.css'),
		`/* Generated from admin application style sources. Do not edit. */\n${adminCss}\n`,
		'utf8',
	),
]);

process.stdout.write(`Composed Storybook application styles: ${outputDirectory}\n`);
