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
	'first load' | 'right drawing' | 'words' | 'amber at 8 s' | 'Keep waiting at 10 s' | 'data arrives' | 'refresh';
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
	hold.ms = HOLD_MS;
	await page.goto(r.url, { waitUntil: 'commit' });
	// First load: the screen's own drawing covers the content area with who and what.
	try {
		await expect(page.locator('rc-load-overlay.on:not(.full)')).toBeVisible({ timeout: 6000 });
		r.checks['first load'] = 'ok';
	} catch {
		hold.ms = 0;
		// A page that reads nothing (a link to the vendor's own page, or the projects list the Boot
		// sequence already loaded) correctly shows no loader.
		if (readsNothing) {
			r.checks['first load'] = `ok (${readsNothing}: no read, so no loader)`;
			for (const k of [
				'right drawing',
				'words',
				'amber at 8 s',
				'Keep waiting at 10 s',
				'data arrives',
				'refresh',
			] as const)
				r.checks[k] = 'n/a: no read';
			return;
		}
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
	await unlock(page);
	await page.route('**/api/projects', async (route) => {
		if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, HOLD_MS));
		await route.continue().catch(() => undefined);
	});
	await page.reload({ waitUntil: 'commit' });
	const full = page.locator('rc-load-overlay.full.on');
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
