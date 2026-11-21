import { writeFileSync } from 'node:fs';

import { type Page, expect, test } from '@playwright/test';

import { CONSOLE_MENU } from '../src/app/menu/console-menu.data';
import { LOADER_OF_PAGE, LOADER_OF_SCREEN } from '../src/app/shared/loaders/loader-art';

/**
 * Every screen's loader in every state (owner, 21 Nov: "all animations per page ... verified per
 * page"): each screen's reads are held back 11.5 s, then the first load, amber at 8 s, Keep waiting at
 * 10 s, the data arriving and a refresh with data on screen are checked on that screen. Slow (about
 * ten minutes), so it runs only with `pnpm e2e:console:loaders`, after the main suite has made the
 * test project. A report of every screen goes to CONSOLE_E2E_LOADERS_OUT when set.
 */
const PIN = '135790';
const HOLD_MS = 11_500;
const PAGES_AT_ONCE = 6;
/** Reads the shell itself needs at once (the projects list, the lock, the screen list). */
const FAST = (path: string) =>
	path === '/api/projects' || path.startsWith('/api/lock') || path === '/api/product-screens';

type Check =
	| 'at least 1 s'
	| 'first load'
	| 'right drawing'
	| 'words'
	| 'amber at 8 s'
	| 'Keep waiting at 10 s'
	| 'data arrives'
	| 'refresh';
interface Result {
	place: string;
	url: string;
	loader: string;
	checks: Partial<Record<Check, string>>;
}

test.skip(!process.env['CONSOLE_E2E_LOADERS'], 'Runs with pnpm e2e:console:loaders.');

async function unlock(page: Page): Promise<void> {
	await page.goto('/');
	await expect(page.getByText(/Enter your 6-digit console PIN/)).toBeVisible();
	await page.keyboard.type(PIN);
	await expect(page.getByRole('heading', { name: 'All projects' })).toBeVisible();
}

/** Holds every read but the shell's own for `hold.ms`. */
async function holdReads(page: Page, hold: { ms: number }): Promise<void> {
	await page.route(/\/api\//, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (route.request().method() !== 'OPTIONS' && !FAST(path) && hold.ms)
			await new Promise((r) => setTimeout(r, hold.ms));
		await route.continue().catch(() => undefined);
	});
}

/**
 * Records, inside the page, when each loader is fully on screen: from the moment it shows until its
 * fade begins. Playwright's own polling sees a loader late, so it cannot time one second.
 */
async function recordLoaders(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const spans: Record<string, Array<[number, number]>> = { main: [], boot: [] };
		const open: Record<string, number | null> = { main: null, boot: null };
		(window as unknown as { rcLoaderSpans: typeof spans }).rcLoaderSpans = spans;
		const look = () => {
			const t = performance.now();
			for (const el of document.querySelectorAll('rc-load-overlay')) {
				const key = el.classList.contains('full') ? 'boot' : 'main';
				const shown = el.classList.contains('on') && !el.classList.contains('out');
				const since = open[key] ?? null;
				if (shown && since === null) open[key] = t;
				else if (!shown && since !== null) {
					spans[key]?.push([since, t]);
					open[key] = null;
				}
			}
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['class'],
		});
	});
}

const FADE_MS = 350;
/**
 * How long the page's own loader was fully in view, in seconds: after the Boot sequence (when the
 * page was reloaded) had faded away completely.
 */
const inView = (page: Page) =>
	page.evaluate((fade) => {
		const s = (window as unknown as { rcLoaderSpans?: Record<string, Array<[number, number]>> }).rcLoaderSpans;
		const bootGone = Math.max(0, ...(s?.['boot'] ?? []).map(([, end]) => end + fade));
		const main = s?.['main'] ?? [];
		return main.reduce((sum, [from, to]) => sum + Math.max(0, to - Math.max(from, bootGone)), 0) / 1000;
	}, FADE_MS);
const bootShown = (page: Page) =>
	page.evaluate(() => {
		const s = (window as unknown as { rcLoaderSpans?: Record<string, Array<[number, number]>> }).rcLoaderSpans;
		return (s?.['boot'] ?? []).map(([from, to]) => (to - from) / 1000);
	});
const enough = (s: number) => (s >= 0.995 ? `ok (${s.toFixed(2)} s)` : `only ${s.toFixed(2)} s`);

const seconds = async (page: Page) =>
	Number.parseFloat(
		(await page
			.locator('rc-load-overlay:not(.full) .rc-load-time')
			.textContent({ timeout: 2000 })
			.catch(() => '0')) ?? '0',
	);

/** Reads the overlay's query cache in the page (dev build): reads with data that a refresh would redo. */
const refetchable = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as { ng?: { getComponent(e: Element): unknown } };
		const el = document.querySelector('rc-load-overlay:not(.full)');
		const c =
			el &&
			(w.ng?.getComponent(el) as {
				client?: { getQueryCache(): { getAll(): unknown[] }; invalidateQueries(f: unknown): Promise<void> };
			});
		const all = (c?.client?.getQueryCache().getAll() ?? []) as Array<{
			queryKey: unknown[];
			getObserversCount(): number;
			state: { status: string };
			observers: Array<{ options: { refetchInterval?: unknown } }>;
		}>;
		// The shell's own lists are not the screen's reads.
		const shell = ['projects', 'product-screens', 'lock-status', 'attention-counts', 'key-source'];
		const live = all.filter(
			(q) => q.getObserversCount() > 0 && q.state.status !== 'pending' && !shell.includes(String(q.queryKey[0])),
		);
		return {
			withData: live.length,
			polling: live.filter((q) => q.observers.some((o) => !!o.options.refetchInterval)).length,
		};
	});
const invalidate = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as { ng?: { getComponent(e: Element): unknown } };
		const el = document.querySelector('rc-load-overlay:not(.full)');
		const c = el && (w.ng?.getComponent(el) as { client?: { invalidateQueries(f: unknown): Promise<void> } });
		void c?.client?.invalidateQueries({ type: 'active' });
	});

async function checkScreen(
	page: Page,
	hold: { ms: number },
	r: Result,
	label: string | null,
	readsNothing: string | null,
): Promise<void> {
	const overlay = page.locator('rc-load-overlay:not(.full)');
	const on = page.locator('rc-load-overlay.on:not(.full)');
	// Every page shows its loader at once and keeps it at least a second, even when its reads answer
	// at once or it reads nothing (owner, 21 Nov).
	// Opening it fresh, the Boot sequence shows first; then this page's own loader, a full second in
	// view after the Boot sequence has faded.
	hold.ms = 0;
	await page.goto(r.url, { waitUntil: 'commit' });
	try {
		await expect(on).toBeVisible({ timeout: 6000 });
		// Under the Boot sequence the page's loader may come and go; what counts is after it lifts.
		await expect(page.locator('rc-load-overlay.full.on')).toHaveCount(0, { timeout: 8000 });
		await expect(on).toHaveCount(0, { timeout: readsNothing ? 6000 : 30_000 });
		r.checks['at least 1 s'] = enough(await inView(page));
	} catch {
		r.checks['at least 1 s'] = 'no loader when the page opened';
	}
	if (readsNothing) {
		// Nothing to read: the loader is the page's opening second; it can never be slow or refresh.
		await page.goto(r.url, { waitUntil: 'commit' });
		try {
			await expect(on).toBeVisible({ timeout: 4000 });
			r.checks['first load'] = `ok (${readsNothing}: reads nothing, shows its second)`;
		} catch {
			r.checks['first load'] = 'no loader';
			return;
		}
		const shownHere = await overlay.getAttribute('data-loader');
		r.checks['right drawing'] = shownHere === r.loader ? 'ok' : `showed ${shownHere}`;
		const t = ((await overlay.locator('.rc-load-title').textContent()) ?? '').trim();
		r.checks.words = /^Reading \S/.test(t) ? `ok (${t})` : `“${t}”`;
		r.checks['amber at 8 s'] = 'n/a: reads nothing, so it is never slow';
		r.checks['Keep waiting at 10 s'] = 'n/a: reads nothing, so it is never slow';
		try {
			await expect(on).toHaveCount(0, { timeout: 6000 });
			r.checks['data arrives'] = 'ok (the page shows after its second)';
		} catch {
			r.checks['data arrives'] = 'the cover stayed';
		}
		r.checks.refresh = 'n/a: reads nothing';
		return;
	}
	hold.ms = HOLD_MS;
	await page.goto(r.url, { waitUntil: 'commit' });
	// First load: the screen's own drawing covers the content area with who and what.
	try {
		await expect(on).toBeVisible({ timeout: 6000 });
		r.checks['first load'] = 'ok';
	} catch {
		hold.ms = 0;
		r.checks['first load'] = 'no loader: this screen made no read that waited';
		return;
	}
	const shown = await overlay.getAttribute('data-loader');
	r.checks['right drawing'] =
		shown === r.loader && (await overlay.locator('rc-load-piece svg > *').count()) > 0 ? 'ok' : `showed ${shown}`;
	const title = (await overlay.locator('.rc-load-title').textContent()) ?? '';
	const what =
		(await overlay
			.locator('.rc-load-what')
			.textContent()
			.catch(() => '')) ?? '';
	r.checks.words =
		/^Reading \S/.test(title.trim()) && (!label || what.includes(label))
			? `ok (${title.trim()} · ${what.trim()})`
			: `“${title.trim()}” “${what.trim()}”`;
	// Slow: amber at 8 s, Keep waiting at 10 s.
	try {
		await expect(page.locator('rc-load-overlay.slow:not(.full)')).toBeVisible({ timeout: 10_000 });
		const s = await seconds(page);
		r.checks['amber at 8 s'] = s >= 7.9 && s < 9.5 ? `ok (${s.toFixed(1)} s)` : `turned amber at ${s.toFixed(1)} s`;
	} catch {
		r.checks['amber at 8 s'] = 'never turned amber';
	}
	try {
		const keep = overlay.getByRole('button', { name: 'Keep waiting' });
		await expect(keep).toBeVisible({ timeout: 4000 });
		const s = await seconds(page);
		await keep.click();
		await expect(keep).toBeHidden({ timeout: 2000 });
		r.checks['Keep waiting at 10 s'] =
			s >= 9.9 && s < 11.4 ? `ok (${s.toFixed(1)} s, then hidden when pressed)` : `appeared at ${s.toFixed(1)} s`;
	} catch {
		r.checks['Keep waiting at 10 s'] = 'Keep waiting did not appear or did not hide';
	}
	// Data arrives: the cover fades and the screen shows (a read that failed and retries waits once more).
	try {
		await expect(page.locator('rc-load-overlay.on:not(.full)')).toHaveCount(0, { timeout: 26_000 });
		const text = ((await page.locator('.rc-main').innerText()) ?? '').replace(/Refreshing…/g, '').trim();
		r.checks['data arrives'] = text.length > 10 ? 'ok' : 'the screen stayed empty';
	} catch {
		r.checks['data arrives'] = 'the cover stayed';
	}
	// Refresh with what the read brought on screen: the line and the chip, never the cover. A screen
	// that refreshes itself every few seconds lights it only when a refresh is slow (over 1.5 s).
	hold.ms = 3500;
	const q = await refetchable(page);
	if (!q.withData) r.checks.refresh = 'n/a: nothing on this screen came from a read the console can refresh';
	else {
		await invalidate(page);
		try {
			await expect(page.locator('rc-load-overlay.refreshing:not(.full)')).toBeVisible({ timeout: 6000 });
			const covered = await page.locator('rc-load-overlay.on:not(.full)').count();
			const kind = q.withData === q.polling ? 'self-refreshing screen, slow refresh' : 'refresh';
			r.checks.refresh = covered ? 'covered the data' : `ok (${kind}: line and chip, data stayed)`;
			await expect(page.locator('rc-load-overlay.refreshing:not(.full)')).toHaveCount(0, { timeout: 10_000 });
		} catch {
			r.checks.refresh = 'no refresh light';
		}
	}
	hold.ms = 0;
}

test('every screen shows its own loader in every state', async ({ context }, info) => {
	test.setTimeout(45 * 60_000);
	const base = `browser-test-${info.project.name}`;
	const results: Result[] = [];
	const queue: Array<{ r: Result; label: string | null; nothing?: string }> = [];
	const seen = new Set<string>();
	for (const g of CONSOLE_MENU.menu)
		for (const sub of g.subs)
			for (const key of sub.items) {
				const info2 = CONSOLE_MENU.screens[key];
				if (!info2 || seen.has(key)) continue;
				seen.add(key);
				queue.push({
					r: {
						place: [g.label, sub.label, info2.label].filter(Boolean).join(' › '),
						url: `/p/${base}/r/saha-textile/${key}`,
						loader: LOADER_OF_SCREEN[key] ?? '?',
						checks: {},
					},
					label: info2.label,
					nothing: info2.off ? 'a link to the vendor’s own page' : undefined,
				});
			}
	queue.push({
		r: { place: 'Repository › Overview', url: `/p/${base}/r/saha-textile/overview`, loader: 'gauges', checks: {} },
		label: null,
	});
	for (const [page, loader] of [
		['projects', LOADER_OF_PAGE['projects']],
		['audit', LOADER_OF_PAGE['audit']],
		['attention', LOADER_OF_PAGE['attention']],
	] as const)
		queue.push({
			r: { place: `Console › ${page}`, url: `/console/${page}`, loader: loader ?? '?', checks: {} },
			label: null,
			nothing: page === 'projects' ? 'drawn from the projects list the Boot sequence loads' : undefined,
		});
	for (const [page, loader] of [
		['overview', 'gauges'],
		['settings', 'vault'],
	] as const)
		queue.push({ r: { place: `Project › ${page}`, url: `/p/${base}/${page}`, loader, checks: {} }, label: null });

	const only = (process.env['CONSOLE_E2E_LOADERS_ONLY'] ?? '').split(',').filter(Boolean);
	if (only.length) queue.splice(0, queue.length, ...queue.filter((x) => only.some((o) => x.r.url.endsWith(`/${o}`))));
	const worker = async () => {
		const page = await context.newPage();
		const hold = { ms: 0 };
		await holdReads(page, hold);
		await recordLoaders(page);
		await unlock(page);
		for (;;) {
			const next = queue.shift();
			if (!next) break;
			await checkScreen(page, hold, next.r, next.label, next.nothing ?? null).catch((err: Error) => {
				next.r.checks['first load'] ??= `error: ${err.message.split('\n')[0]}`;
			});
			// A screen not in this repository's menu says so instead of reading anything.
			if (
				next.r.checks['first load']?.startsWith('no loader') &&
				(await page.getByText('Not in this repository').count())
			)
				next.r.checks['first load'] = 'not in the test repository’s menu';
			results.push(next.r);
		}
		await page.close();
	};
	await Promise.all(Array.from({ length: PAGES_AT_ONCE }, worker));

	// The console opening: the Boot sequence over the whole window while the projects list loads.
	const boot: Result = {
		place: 'Opening the console after the PIN',
		url: '/console/projects',
		loader: 'boot',
		checks: {},
	};
	const page = await context.newPage();
	await recordLoaders(page);
	await unlock(page);
	const full = page.locator('rc-load-overlay.full.on');
	const main = page.locator('rc-load-overlay.on:not(.full)');
	// Moving between pages in the menu (no Boot sequence): each page's loader a full second, whether
	// the page reads (Audit) or not (All projects).
	await expect(full).toHaveCount(0, { timeout: 8000 });
	await expect(main).toHaveCount(0, { timeout: 8000 });
	for (const [label, url, loader] of [
		['Audit (every project)', '/console/audit', LOADER_OF_PAGE['audit']],
		['All projects', '/console/projects', LOADER_OF_PAGE['projects']],
	] as const) {
		const moved: Result = { place: `Moving in the menu › ${label}`, url, loader: loader ?? '?', checks: {} };
		// The console's own router moves, as a menu press or the Back button does (the phone's menu is
		// folded away, so it is not clicked).
		await page.evaluate((to) => {
			const s = (window as unknown as { rcLoaderSpans: Record<string, unknown[]> }).rcLoaderSpans;
			for (const k of Object.keys(s)) s[k]?.splice(0);
			history.pushState(null, '', to);
			dispatchEvent(new PopStateEvent('popstate', { state: null }));
		}, url);
		try {
			await expect(main).toBeVisible({ timeout: 4000 });
			moved.checks['first load'] = 'ok';
			moved.checks['right drawing'] =
				(await page.locator('rc-load-overlay:not(.full)').getAttribute('data-loader')) === loader
					? 'ok'
					: 'wrong drawing';
			await expect(main).toHaveCount(0, { timeout: 8000 });
			moved.checks['at least 1 s'] = enough(await inView(page));
		} catch {
			moved.checks['first load'] = 'no loader when the page opened';
		}
		results.push(moved);
	}
	// Opening fresh with the projects list at once: the Boot sequence still shows a full second.
	await page.reload({ waitUntil: 'commit' });
	try {
		await expect(full).toBeVisible({ timeout: 6000 });
		await expect(full).toHaveCount(0, { timeout: 8000 });
		boot.checks['at least 1 s'] = enough((await bootShown(page))[0] ?? 0);
	} catch {
		boot.checks['at least 1 s'] = 'no Boot sequence';
	}
	await page.route('**/api/projects', async (route) => {
		if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, HOLD_MS));
		await route.continue().catch(() => undefined);
	});
	await page.reload({ waitUntil: 'commit' });
	try {
		await expect(full).toBeVisible({ timeout: 6000 });
		boot.checks['first load'] = 'ok';
		boot.checks['right drawing'] = (await full.getAttribute('data-loader')) === 'boot' ? 'ok' : 'wrong drawing';
		await expect(page.locator('rc-load-overlay.full.slow')).toBeVisible({ timeout: 10_000 });
		boot.checks['amber at 8 s'] = 'ok';
		await expect(full.getByRole('button', { name: 'Keep waiting' })).toBeVisible({ timeout: 4000 });
		boot.checks['Keep waiting at 10 s'] = 'ok';
		await expect(page.locator('rc-load-overlay.full.on')).toHaveCount(0, { timeout: 8000 });
		boot.checks['data arrives'] = 'ok';
		boot.checks.refresh = 'n/a: the projects list refreshes behind the screen';
	} catch (err) {
		boot.checks['data arrives'] ??= `failed: ${(err as Error).message.split('\n')[0]}`;
	}
	results.push(boot);

	const out = process.env['CONSOLE_E2E_LOADERS_OUT'];
	if (out) writeFileSync(`${out}-${info.project.name}.json`, JSON.stringify(results, null, 1));
	const failed = results.filter((r) =>
		Object.values(r.checks).some((v) => v && !/^ok|^n\/a|not in the test repository/.test(v)),
	);
	for (const f of failed) console.warn('LOADER-FAIL', f.place, JSON.stringify(f.checks));
	console.warn('LOADER-SUMMARY', results.length, 'places,', failed.length, 'with a failed check');
	expect(failed.map((f) => `${f.place}: ${JSON.stringify(f.checks)}`)).toEqual([]);
});
