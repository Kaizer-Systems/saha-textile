/**
 * Search engines, our own sitemap check (brief 26gq3NbcbBESea6abRtsa3, screen 5): reads a site's
 * sitemap (and the sitemaps a sitemap index lists), then asks for every page it lists, one at a time
 * and at most four a second, without following redirects. Prints progress and the result as JSON
 * lines for the Mac helper's job view; paths and answer codes only, never page content.
 *
 *   node scripts/release-console/sitemap-check.mjs --origin https://staging.sahatextile.com [--path /sitemap.xml]
 *
 * `--local` reads this computer's stack instead (its own certificate, so certificate checks are off,
 * and only for a `.localhost` address).
 */
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PAGES_PER_SECOND = 4;
export const MAX_PAGES = 5000;
export const MAX_FILES = 20;
const MAX_FAILURES = 50;
const AGENT = 'release-console-sitemap-check';

/** The `<loc>` entries of a sitemap or sitemap index, with XML entities decoded. */
export function parseSitemap(xml) {
	const index = /<sitemapindex[\s>]/i.test(xml);
	const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) =>
		m[1]
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'"),
	);
	return { index, locs };
}

/** A sitemap address as a path on the checked site (its own host is not used), or null. */
export function toPath(loc) {
	try {
		const u = new URL(loc);
		return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.pathname}${u.search}` : null;
	} catch {
		return loc.startsWith('/') ? loc : null;
	}
}

/** Where a page's answer goes in the result. */
export function classify(status) {
	if (status === 200) return 'ok';
	if (status >= 300 && status < 400) return 'redirects';
	if (status === 404 || status === 410) return 'notFound';
	return 'other';
}

/** Whether an origin is this computer's, where the stack's own certificate is accepted. */
export function isLocal(origin) {
	try {
		const host = new URL(origin).hostname;
		return host === 'localhost' || host.endsWith('.localhost');
	} catch {
		return false;
	}
}

/**
 * One GET without following redirects: the status, and the body only when asked (the sitemap).
 * @returns {Promise<{ status: number, body: string }>}  status 0 when there was no answer
 */
export function get(url, { body = false, insecure = false, timeoutMs = 10_000 } = {}) {
	return new Promise((resolve) => {
		const u = new URL(url);
		const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
		const req = send(
			u,
			{ method: 'GET', headers: { 'user-agent': AGENT }, timeout: timeoutMs, rejectUnauthorized: !insecure },
			(res) => {
				if (!body) {
					res.resume();
					res.on('end', () => resolve({ status: res.statusCode ?? 0, body: '' }));
					return;
				}
				let text = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => {
					if (text.length < 20_000_000) text += chunk;
				});
				res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
			},
		);
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.on('error', () => resolve({ status: 0, body: '' }));
		req.end();
	});
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads the sitemap and checks every page it lists.
 * @param {{ origin: string, path?: string, insecure?: boolean, fetchPage?: typeof get,
 *   sleep?: (ms: number) => Promise<void>, now?: () => number, emit?: (event: object) => void }} o
 */
export async function checkSitemap({
	origin,
	path = '/sitemap.xml',
	insecure = false,
	fetchPage = get,
	sleep = pause,
	now = Date.now,
	emit = () => {},
}) {
	const base = origin.replace(/\/+$/, '');
	// The stack's own certificate is accepted on this computer only.
	insecure = insecure && isLocal(base);
	const result = {
		origin: base,
		sitemap: path,
		at: new Date(now()).toISOString(),
		listed: 0,
		checked: 0,
		ok: 0,
		redirects: 0,
		notFound: 0,
		other: 0,
		failures: [],
		paths: [],
		note: '',
	};
	const files = [path];
	const pages = new Set();
	const hosts = new Set();
	for (let i = 0; i < files.length && i < MAX_FILES; i++) {
		const answer = await fetchPage(`${base}${files[i]}`, { body: true, insecure });
		if (answer.status !== 200) {
			if (i === 0) {
				result.note = `${path} answered ${answer.status || 'nothing'}: no pages to check.`;
				return result;
			}
			continue;
		}
		const { index, locs } = parseSitemap(answer.body);
		for (const loc of locs) {
			const p = toPath(loc);
			if (!p) continue;
			try {
				hosts.add(new URL(loc).host);
			} catch {
				// a relative address: nothing to note
			}
			if (index) {
				if (!files.includes(p)) files.push(p);
			} else if (pages.size < MAX_PAGES) pages.add(p);
		}
	}
	result.paths = [...pages];
	result.listed = pages.size;
	const notes = [];
	const own = new URL(base).host;
	const others = [...hosts].filter((h) => h !== own);
	if (others.length)
		notes.push(`The sitemap lists addresses on ${others.join(', ')}; the same paths were checked on ${own}.`);
	if (files.length > MAX_FILES) notes.push(`Only the first ${MAX_FILES} sitemap files were read.`);
	if (pages.size >= MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} pages were checked.`);
	const gap = 1000 / PAGES_PER_SECOND;
	let last = Number.NEGATIVE_INFINITY;
	for (const p of pages) {
		const wait = last + gap - now();
		if (wait > 0) await sleep(wait);
		last = now();
		const { status } = await fetchPage(`${base}${p}`, { insecure });
		result.checked += 1;
		result[classify(status)] += 1;
		if (status !== 200 && result.failures.length < MAX_FAILURES) result.failures.push({ path: p, status });
		if (result.checked % 25 === 0) emit({ progress: { checked: result.checked, total: pages.size } });
	}
	result.note = notes.join(' ');
	return result;
}

/** This computer's stack origin: the shop on its HTTPS port from the stack's settings. */
export function localOrigin(root = ROOT) {
	const file = join(root, 'docker/stack/env/stack.env');
	const port = /STACK_HTTPS_PORT=(\d+)/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '')?.[1] ?? '443';
	return `https://local.saha-textile.localhost${port === '443' ? '' : `:${port}`}`;
}

/** The command line: `--origin https://host` or `--local`, and an optional `--path`. */
export function argsOf(argv) {
	const value = (flag) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const path = value('--path') ?? '/sitemap.xml';
	if (!/^\/[A-Za-z0-9._\-/]*\.xml$/.test(path)) throw new Error('The sitemap path must be like /sitemap.xml.');
	if (argv.includes('--local')) return { origin: localOrigin(), path, insecure: true };
	const origin = value('--origin') ?? '';
	if (!/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(origin)) throw new Error('Give the site as https://host.');
	return { origin, path, insecure: false };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	try {
		const args = argsOf(process.argv.slice(2));
		const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
		process.stdout.write(`Checking ${args.origin}${args.path}, at most ${PAGES_PER_SECOND} pages a second…\n`);
		const result = await checkSitemap({ ...args, emit: say });
		process.stdout.write(
			`Checked ${result.checked} of ${result.listed}: ${result.ok} answered 200, ${result.redirects} redirect, ${result.notFound} not found, ${result.other} other.\n`,
		);
		say({ result });
		process.exitCode = result.listed === 0 && result.note ? 1 : 0;
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
