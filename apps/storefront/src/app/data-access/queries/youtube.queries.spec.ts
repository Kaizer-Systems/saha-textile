import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { injectChannelVideosQuery, injectVideoRailQuery } from './youtube.queries';

const captured = vi.hoisted(() => ({
	options: undefined as unknown as () => { queryKey: unknown[]; queryFn: () => Promise<unknown> },
}));
vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
		captured.options = options;
		return {};
	},
}));
vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test' },
	runtimeConfigReady: Promise.resolve(),
}));

const run = (http: unknown, inject: () => unknown) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	TestBed.runInInjectionContext(inject);
	return captured.options();
};

describe('injectChannelVideosQuery', () => {
	it('reads the cached videos and Shorts', async () => {
		const answer = { videos: [{ videoId: 'v' }], shorts: [], channelUrl: 'https://www.youtube.com/@a' };
		const get = vi.fn(() => of(answer));
		const options = run({ get }, () => injectChannelVideosQuery());
		expect(options.queryKey).toEqual(['youtube', 'videos']);
		expect(await options.queryFn()).toEqual(answer);
		expect(get).toHaveBeenCalledWith('https://api.test/storefront/youtube/videos');
	});

	it('answers "no videos" when the API cannot be reached', async () => {
		const options = run({ get: () => throwError(() => new Error('down')) }, () => injectChannelVideosQuery());
		expect(await options.queryFn()).toMatchObject({ videos: [], shorts: [] });
	});
});

describe('injectVideoRailQuery', () => {
	it("reads a placement's rail", async () => {
		const get = vi.fn(() => of({ videos: [{ videoId: 'v' }] }));
		const options = run({ get }, () => injectVideoRailQuery(() => 'home'));
		expect(options.queryKey).toEqual(['youtube', 'rail', 'home']);
		expect(await options.queryFn()).toEqual([{ videoId: 'v' }]);
		expect(get).toHaveBeenCalledWith('https://api.test/storefront/youtube/rail', { params: { placement: 'home' } });
	});

	it('shows no rail when the API cannot be reached', async () => {
		const options = run({ get: () => throwError(() => new Error('down')) }, () =>
			injectVideoRailQuery(() => 'home'),
		);
		expect(await options.queryFn()).toEqual([]);
	});
});
