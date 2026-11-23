import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONSOLE_API, ConsoleApi, coverageQuery } from './console-api';

const AT = '2026-11-24T03:00:00.000Z';

describe('the console API’s coverage calls (brief CRmpBdP3ce62g1JoCAhh23)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('writes a run’s question: source, run, and the change and file when asked', () => {
		expect(coverageQuery({ source: 'ci', run: '901' })).toBe('source=ci&run=901');
		expect(coverageQuery({ source: 'mac', run: 'mac', base: null })).toBe('source=mac&run=mac');
		expect(coverageQuery({ source: 'ci', run: '901', base: 'feat/x', path: 'apps/a b.ts' })).toBe(
			'source=ci&run=901&base=feat%2Fx&path=apps%2Fa+b.ts',
		);
	});

	it('asks for the runs, a run’s tree and one file, and checks each answer', async () => {
		const answers: Record<string, unknown> = {
			'/coverage/runs': { ci: [], ciMessage: 'none yet', mac: null, macMessage: null },
			'/coverage/tree': {
				state: 'ok',
				readAt: AT,
				data: {
					source: 'ci',
					run: '901',
					sha: 's',
					ref: 'dev',
					finishedAt: AT,
					uncommitted: false,
					tree: { n: 'r', c: null, k: [] },
					workspaces: [],
					tests: { passed: 0, failed: 0, skipped: 0, slowest: [] },
					changed: null,
				},
			},
			'/coverage/file': { state: 'not-connected', message: 'No key.' },
		};
		const fetch = vi.fn(async (url: string) => {
			const hit = Object.keys(answers).find((k) => url.includes(k)) as string;
			return new Response(JSON.stringify(answers[hit]), { status: 200 });
		});
		vi.stubGlobal('fetch', fetch);
		TestBed.configureTestingModule({ providers: [provideRouter([]), provideTanStackQuery(new QueryClient())] });
		const api = TestBed.inject(ConsoleApi);
		expect((await api.coverageRuns('p', 'r')).ciMessage).toBe('none yet');
		expect((await api.coverageTree('p', 'r', { source: 'ci', run: '901', base: 'commit' })).state).toBe('ok');
		expect(await api.coverageFile('p', 'r', { source: 'mac', run: 'mac', path: 'a.ts' })).toEqual({
			state: 'not-connected',
			message: 'No key.',
		});
		expect(fetch.mock.calls.map(([url]) => String(url).replace(CONSOLE_API, ''))).toEqual([
			'/api/projects/p/repos/r/coverage/runs',
			'/api/projects/p/repos/r/coverage/tree?source=ci&run=901&base=commit',
			'/api/projects/p/repos/r/coverage/file?source=mac&run=mac&path=a.ts',
		]);
	});
});
