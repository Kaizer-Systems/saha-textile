import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { TagService } from '@data-access/services/tag.service';

import { injectTagQuery } from './tag.queries';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
}

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQuery: (options: () => Options) => options,
}));

describe('one tag of a kind', () => {
	it('asks for that kind’s list only, and finds the tag in it', async () => {
		const getTags = vi.fn(() => of({ data: [{ id: 7, name: 'Weaving' }] }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: TagService, useValue: { getTags } }] });
		const options = (
			TestBed.runInInjectionContext(() =>
				injectTagQuery(
					() => 7,
					() => 'post',
				),
			) as unknown as () => Options
		)();
		expect(options.queryKey).toEqual(['tag', 'post', 7]);
		await expect(options.queryFn()).resolves.toEqual({ id: 7, name: 'Weaving' });
		expect(getTags).toHaveBeenCalledWith({ type: 'post' });
	});
});
