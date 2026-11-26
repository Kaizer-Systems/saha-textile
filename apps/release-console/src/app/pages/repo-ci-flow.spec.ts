import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { RepoCi } from './repo-ci';
import { ConsoleApi } from '../data/console-api';

function make(runs: () => Promise<unknown>) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: { runs: vi.fn(runs) } },
		],
	});
	TestBed.overrideComponent(RepoCi, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(RepoCi);
	fixture.componentRef.setInput('projectId', 'proj_1');
	fixture.componentRef.setInput('repo', { id: 'shop' });
	fixture.detectChanges();
	return (fixture.componentInstance as unknown as { state: () => string }).state;
}
const run = (status: string, conclusion: string | null) => ({ state: 'ok', data: [{ status, conclusion }] });

describe('a repository’s latest pipeline run', () => {
	it('says how it went, and what it knows while reading or when it cannot read', async () => {
		const reading = make(() => new Promise(() => undefined));
		expect(reading()).toBe('reading…');
		const cases: Array<[unknown, string]> = [
			[{ state: 'error', message: 'No key' }, 'not connected'],
			[{ state: 'ok', data: [] }, 'no runs'],
			[run('in_progress', null), 'running'],
			[run('completed', 'success'), 'passing'],
			[run('completed', 'failure'), 'failed'],
			[run('completed', 'cancelled'), 'cancelled'],
			[run('completed', null), 'unknown'],
		];
		for (const [answer, words] of cases) {
			const state = make(async () => answer);
			await vi.waitFor(() => expect(state()).toBe(words));
		}
		const failed = make(async () => Promise.reject(new Error('down')));
		await vi.waitFor(() => expect(failed()).toBe('unknown'));
	});
});
