import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DoJobsScreen } from './do-jobs';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type { Droplet, DropletJob } from '@saha-textile/release-console-contracts';

/** The screen's members these tests use (protected on the component). */
interface Screen {
	job: { data: () => unknown };
	droplets: { data: () => unknown };
	tags: { isSuccess: () => boolean };
	removable: () => Droplet[];
	message: () => string;
	tagOf(j: DropletJob): string | null;
	askTag(j: DropletJob): boolean;
	dismiss(j: DropletJob): void;
	destroy(d: Droplet): Promise<void>;
	fix(environment: string, kind: 'finish' | 'renew'): Promise<void>;
	addresses(j: DropletJob): string;
}

const job = (over: Partial<DropletJob> = {}): DropletJob =>
	({
		id: 'job_1',
		kind: 'create',
		state: 'done',
		dropletId: 7,
		environment: 'staging',
		ipv4: null,
		ipv6: null,
		privateIp: null,
		steps: [],
		...over,
	}) as unknown as DropletJob;
const droplet = (id: number, name: string, tags: string[]) => ({ id, name, tags }) as unknown as Droplet;

function make(options: { tab?: string; jobId?: string } = {}) {
	const api = {
		dropletJob: vi.fn(async () => job()),
		dropletJobs: vi.fn(async () => []),
		droplets: vi.fn(async () => ({
			state: 'ok',
			data: [
				droplet(1, 'web-1', ['proj_1']),
				droplet(2, 'web-prod', ['proj_1']),
				droplet(3, 'web-3', ['proj_1', 'production']),
				droplet(4, 'other', ['proj_9']),
			],
		})),
		envTags: vi.fn(async () => ({ 'do:droplet:8': 'staging' })),
		deployTokens: vi.fn(async () => []),
		destroyDroplet: vi.fn(async () => job({ id: 'job_2' })),
		serverFix: vi.fn(async () => job({ id: 'job_3' })),
	};
	const router = { navigate: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{
				provide: ActivatedRoute,
				useValue: { queryParamMap: of(convertToParamMap(options.jobId ? { job: options.jobId } : {})) },
			},
			{
				provide: ConsoleContext,
				useValue: {
					projectId: () => 'proj_1',
					repoId: () => 'shop',
					repo: () => ({ cloud: [{ id: 'c1', vendor: 'digitalocean' }] }),
				},
			},
		],
	});
	TestBed.overrideComponent(DoJobsScreen, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(DoJobsScreen);
	if (options.tab) fixture.componentRef.setInput('tab', options.tab);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Screen, api, router };
}

afterEach(() => {
	sessionStorage.clear();
});

describe('the droplet jobs screen', () => {
	it('follows the job in the address, and lists only this project’s droplets that are not production', async () => {
		const following = make({ jobId: 'job_1' });
		await vi.waitFor(() => expect(following.c.job.data()).toBeTruthy());
		expect(following.api.dropletJob).toHaveBeenCalledWith('proj_1', 'shop', 'c1', 'job_1');
		const destroy = make({ tab: 'destroy' });
		await vi.waitFor(() => expect(destroy.c.droplets.data()).toBeTruthy());
		expect(destroy.c.removable().map((d) => d.id)).toEqual([1]);
	});

	it('asks once for a finished create’s environment, unless tagged or cancelled, and remembers the cancel', async () => {
		const { c } = make();
		expect(c.tagOf(job({ dropletId: null as unknown as number }))).toBeNull();
		expect(c.askTag(job())).toBe(false);
		await vi.waitFor(() => expect(c.tags.isSuccess()).toBe(true));
		expect(c.tagOf(job({ dropletId: 8 }))).toBe('staging');
		expect(c.tagOf(job())).toBeNull();
		expect(c.askTag(job())).toBe(true);
		expect(c.askTag(job({ kind: 'destroy' }))).toBe(false);
		expect(c.askTag(job({ state: 'running' }))).toBe(false);
		expect(c.askTag(job({ dropletId: 8 }))).toBe(false);
		c.dismiss(job());
		expect(c.askTag(job())).toBe(false);
		expect(sessionStorage.getItem('rc-env-tag-dismissed')).toBe('["job_1"]');
	});

	it('reads back the cancels it kept, and starts afresh from anything else', () => {
		sessionStorage.setItem('rc-env-tag-dismissed', '["job_1", 3]');
		expect(make().c.askTag(job())).toBe(false);
		sessionStorage.setItem('rc-env-tag-dismissed', '{"job_1": true}');
		const notAList = make();
		sessionStorage.setItem('rc-env-tag-dismissed', 'not json');
		const broken = make();
		for (const c of [notAList.c, broken.c]) expect(c.tagOf(job())).toBeNull();
	});

	it('says why a destroy or a fix was refused, also when nothing answered', async () => {
		const { c, api, router } = make({ tab: 'destroy' });
		await c.destroy(droplet(1, 'web-1', []));
		expect(router.navigate).toHaveBeenCalledWith([], {
			queryParams: { tab: 'creating', job: 'job_2' },
			queryParamsHandling: 'merge',
		});
		api.destroyDroplet.mockRejectedValueOnce(new Error('Wrong PIN'));
		await c.destroy(droplet(1, 'web-1', []));
		expect(c.message()).toBe('Wrong PIN');
		api.destroyDroplet.mockRejectedValueOnce('down');
		await c.destroy(droplet(1, 'web-1', []));
		expect(c.message()).toBe('The console API did not answer.');
		api.serverFix.mockRejectedValueOnce('down');
		await c.fix('staging', 'renew');
		expect(c.message()).toBe('The console API did not answer.');
	});

	it('writes a server’s addresses, with the private one marked, or a dash for none', () => {
		const { c } = make();
		expect(c.addresses(job())).toBe('—');
		expect(c.addresses(job({ ipv4: '203.0.113.5', privateIp: '10.0.0.2' }))).toBe('203.0.113.5 · private 10.0.0.2');
	});
});
