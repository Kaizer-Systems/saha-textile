#!/usr/bin/env node
/**
 * Builds the "back in a moment" pages that Nginx shows when the storefront, admin or API cannot
 * answer (a reboot or a crash; deploys swap side by side and never show them).
 *
 *   node scripts/build-fallback-pages.mjs <output-folder>
 *
 * Runs after the app builds, inside the image build. Each page is plain HTML with no script, styled
 * by a copy of its app's own built stylesheet and existing classes, because the app is the thing
 * that is down. The deploy fills in the shop name, the logo and the storefront address.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist/fallback'));
const LOCALES = ['en', 'fr'];

const translations = (app, locale) =>
	JSON.parse(readFileSync(join(ROOT, `apps/${app}/public/assets/i18n/${locale}.json`), 'utf8'));

/**
 * The stylesheet an app's built `index.html` links, so a stale file left in the folder is never used.
 * The storefront's server build keeps its page in `dist/client` and its public files in `dist/analog/public`.
 */
function builtStylesheet(indexHtml, publicFolder) {
	const html = readFileSync(indexHtml, 'utf8');
	const href = /<link[^>]+rel="stylesheet"[^>]+href="\/?(assets\/index-[^"]+\.css)"/.exec(html)?.[1];
	if (!href) throw new Error(`No built stylesheet is linked from ${indexHtml}.`);
	return join(publicFolder, href);
}

const escape = (text) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Placeholders the deploy replaces. The logo slot stays empty when the shop has no logo. */
const SHOP_NAME = '__SHOP_NAME__';
const LOGO = '<!--logo-->';
const SITE_URL = '__SITE_URL__';

const FONTS =
	'<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap">';

function page({ locale, title, refresh, stylesheet, body }) {
	return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${refresh ? '<meta http-equiv="refresh" content="15">\n' : ''}<title>${escape(title)} · ${SHOP_NAME}</title>
${FONTS}
<link rel="stylesheet" href="/__fallback/${stylesheet}">
</head>
<body>
${body}
</body>
</html>
`;
}

/**
 * The storefront's maintenance layout (`features/maintenance`), centred with Bootstrap's `mx-auto`:
 * its empty side column only makes room for a background photo, which these pages do not have.
 */
function storefrontBody({ title, text, action = '' }) {
	return `<section class="coming-soon-section pt-0">
	<div class="container-fluid-lg w-100">
		<div class="row">
			<div class="col-xxl-5 col-xl-6 col-lg-7 mx-auto">
				<div class="coming-box">
					<div>
						${LOGO}
						<div class="coming-title"><h2>${escape(title)}</h2></div>
						<p class="coming-text">${escape(text)}</p>${action}
					</div>
				</div>
			</div>
		</div>
	</div>
</section>`;
}

/**
 * The admin's error layout (`features/errors`). Bootstrap's `h-auto min-vh-100` let it grow past the
 * screen instead of clipping, which its fixed full-screen height did on a phone held sideways.
 */
function adminBody({ title, text, action }) {
	return `<section class="error-section section-lg-space h-auto min-vh-100">
	<div class="container-fluid">
		<div class="row">
			<div class="col-xl-6 col-lg-7 m-auto">
				<div class="error-content">
					<img src="/__fallback/401.svg" class="img-fluid" alt="">
					<h2>${escape(title)}</h2>
					<h3 class="text-content">${escape(text)}</h3>
					<a href="" class="btn btn-animation btn-md mx-auto mt-4">${escape(action)}</a>
				</div>
			</div>
		</div>
	</div>
</section>`;
}

const storefrontOut = join(OUT, 'storefront');
const adminOut = join(OUT, 'admin');
mkdirSync(storefrontOut, { recursive: true });
mkdirSync(adminOut, { recursive: true });
copyFileSync(
	builtStylesheet(
		join(ROOT, 'apps/storefront/dist/client/index.html'),
		join(ROOT, 'apps/storefront/dist/analog/public'),
	),
	join(storefrontOut, 'storefront.css'),
);
copyFileSync(
	builtStylesheet(join(ROOT, 'apps/admin/dist/index.html'), join(ROOT, 'apps/admin/dist')),
	join(adminOut, 'admin.css'),
);
copyFileSync(join(ROOT, 'apps/admin/public/assets/svg/401.svg'), join(adminOut, '401.svg'));

for (const locale of LOCALES) {
	const shop = translations('storefront', locale);
	writeFileSync(
		join(storefrontOut, `${locale}.html`),
		page({
			locale,
			title: shop.back_in_a_moment_title,
			refresh: true,
			stylesheet: 'storefront.css',
			body: storefrontBody({ title: shop.back_in_a_moment_title, text: shop.back_in_a_moment_text }),
		}),
	);
	// No refresh: reloading the payment return would post the payment form again.
	writeFileSync(
		join(storefrontOut, `payment-${locale}.html`),
		page({
			locale,
			title: shop.payment_confirming_title,
			refresh: false,
			stylesheet: 'storefront.css',
			body: storefrontBody({
				title: shop.payment_confirming_title,
				text: shop.payment_confirming_text,
				action: `\n\t\t\t\t\t\t<a href="${SITE_URL}/${locale}/account/order" class="btn btn-md text-white theme-bg-color mt-4 mx-auto d-inline-block">${escape(shop.view_my_orders)}</a>`,
			}),
		}),
	);
	const admin = translations('admin', locale);
	writeFileSync(
		join(adminOut, `${locale}.html`),
		page({
			locale,
			title: admin.admin_restarting_title,
			refresh: true,
			stylesheet: 'admin.css',
			body: adminBody({
				title: admin.admin_restarting_title,
				text: admin.admin_restarting_text,
				action: admin.try_again,
			}),
		}),
	);
}

process.stdout.write(`Fallback pages written to ${OUT}\n`);
