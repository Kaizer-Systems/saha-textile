import assert from 'node:assert/strict';
import { test } from 'node:test';

import { argsOf, checkSitemap, classify, isLocal, parseSitemap, toPath } from './sitemap-check.mjs';

const urlset = (...paths) =>
	`<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>https://sahatextile.com${p}</loc></url>`).join('')}</urlset>`;

/** A sample site: answers from a table, never the network. */
function site(pages) {
	const asked = [];
	const fetchPage = async (url, { body = false, insecure = false } = {}) => {
		asked.push({ url, body, insecure });
		const page = pages[new URL(url).pathname + new URL(url).search];
		return page === undefined
			? { status: 404, body: '' }
			: typeof page === 'number'
				? { status: page, body: '' }
				: { status: 200, body: page };
	};
	return { asked, fetchPage };
}

test('reads a sitemap index, maps every address onto the checked site, and counts the answers', async () => {
	const { asked, fetchPage } = site({
		'/sitemap.xml':
			'<sitemapindex><sitemap><loc>https://sahatextile.com/sitemap-products.xml</loc></sitemap></sitemapindex>',
		'/sitemap-products.xml': urlset('/', '/product/a', '/product/b', '/old', '/moved', '/broken'),
		'/': 200,
		'/product/a': 200,
		'/product/b': 200,
		'/moved': 301,
		'/broken': 500,
	});
	let clock = 0;
	const waits = [];
	const events = [];
	const r = await checkSitemap({
		origin: 'https://staging.sahatextile.com/',
		fetchPage,
		now: () => clock,
		sleep: async (ms) => {
			waits.push(ms);
			clock += ms;
		},
		emit: (e) => events.push(e),
	});
	assert.equal(r.origin, 'https://staging.sahatextile.com');
	assert.deepEqual([r.listed, r.checked, r.ok, r.redirects, r.notFound, r.other], [6, 6, 3, 1, 1, 1]);
	assert.deepEqual(r.failures, [
		{ path: '/old', status: 404 },
		{ path: '/moved', status: 301 },
		{ path: '/broken', status: 500 },
	]);
	assert.match(
		r.note,
		/lists addresses on sahatextile\.com; the same paths were checked on staging\.sahatextile\.com/,
	);
	assert.ok(
		asked.every((a) => a.url.startsWith('https://staging.sahatextile.com/')),
		'never leaves the checked site',
	);
	assert.ok(
		asked.every((a) => a.insecure === false),
		'certificates checked off this computer',
	);
	// One page at a time, at most four a second.
	assert.equal(waits.length, 5);
	assert.ok(waits.every((ms) => ms === 250));
	assert.deepEqual(events, []);
});

test('an unreadable sitemap ends with a note and nothing checked', async () => {
	const r = await checkSitemap({ origin: 'https://x.example', fetchPage: site({}).fetchPage, sleep: async () => {} });
	assert.equal(r.listed, 0);
	assert.match(r.note, /\/sitemap\.xml answered 404/);
});

test('certificate checks stay on unless the site is this computer', async () => {
	const local = site({ '/sitemap.xml': urlset('/'), '/': 200 });
	await checkSitemap({
		origin: 'https://local.saha-textile.localhost:8443',
		insecure: true,
		fetchPage: local.fetchPage,
		sleep: async () => {},
	});
	assert.ok(local.asked.every((a) => a.insecure));
	const remote = site({ '/sitemap.xml': urlset('/'), '/': 200 });
	await checkSitemap({
		origin: 'https://sahatextile.com',
		insecure: true,
		fetchPage: remote.fetchPage,
		sleep: async () => {},
	});
	assert.ok(remote.asked.every((a) => !a.insecure));
	assert.equal(isLocal('https://local.saha-textile.localhost:8443'), true);
	assert.equal(isLocal('https://localhost.example.com'), false);
});

test('parses, maps and classifies', () => {
	assert.deepEqual(parseSitemap('<urlset><url><loc> https://a.example/x?a=1&amp;b=2 </loc></url></urlset>'), {
		index: false,
		locs: ['https://a.example/x?a=1&b=2'],
	});
	assert.equal(toPath('https://a.example/p/q'), '/p/q');
	assert.equal(toPath('ftp://a.example/p'), null);
	assert.deepEqual([200, 302, 404, 410, 500, 0].map(classify), [
		'ok',
		'redirects',
		'notFound',
		'notFound',
		'other',
		'other',
	]);
});

test('takes only an https site and an .xml path from the command line', () => {
	assert.deepEqual(argsOf(['--origin', 'https://staging.sahatextile.com']), {
		origin: 'https://staging.sahatextile.com',
		path: '/sitemap.xml',
		insecure: false,
	});
	assert.throws(() => argsOf(['--origin', 'http://a.example']), /https/);
	assert.throws(() => argsOf(['--origin', 'https://a.example/x;id']), /https/);
	assert.throws(() => argsOf(['--origin', 'https://a.example', '--path', '/etc/passwd']), /sitemap path/);
	assert.equal(argsOf(['--local']).insecure, true);
});
