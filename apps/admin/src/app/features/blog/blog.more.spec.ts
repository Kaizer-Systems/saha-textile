import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BlogService } from '@data-access/services/blog.service';
import { NotificationService } from '@data-access/services/notification.service';

import { Blog } from './blog';

const posts = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: (params: () => unknown) => {
		params();
		return { data: () => posts.value };
	},
}));

function render(blogs: Record<string, unknown>) {
	const toasts = { showError: vi.fn(), showSuccess: vi.fn() };
	const client = { invalidateQueries: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: BlogService, useValue: blogs },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
		],
	});
	TestBed.overrideComponent(Blog, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Blog);
	fixture.detectChanges();
	return { page: fixture.componentInstance, toasts, client };
}

const rows = [
	{ id: 'a', title: 'Draft one', status: '0' },
	{ id: 'b', title: 'Live one', status: '1' },
];

describe('the blog list when things go wrong', () => {
	it('reloads after a refused take-down, and deletes nothing for no ticks', () => {
		const deletePost = vi.fn(() => of(undefined));
		const { page, client } = render({
			setStatus: vi.fn(() => throwError(() => new Error('refused'))),
			deletePost,
		});
		page.status({ id: 'b', status: 0 } as never);
		expect(client.invalidateQueries).toHaveBeenCalled();
		page.deleteAll(null as never);
		expect(deletePost).not.toHaveBeenCalled();
	});

	it('names every post that could not go live and counts none', () => {
		posts.value = { data: rows, total: 2 };
		const { page, toasts } = render({ goLive: vi.fn(() => throwError(() => new Error('offline'))) });
		TestBed.tick();
		page.bulkGoLive(['a']);
		expect(toasts.showSuccess).not.toHaveBeenCalled();
		expect(toasts.showError).toHaveBeenCalledWith('Draft one: blog_rejected');
		page.bulkGoLive(null as never);
		expect(toasts.showError).toHaveBeenCalledTimes(1);
		posts.value = undefined;
	});

	it('takes down every live post it can, saying so only for what happened', () => {
		posts.value = { data: rows, total: 2 };
		const setStatus = vi.fn(() => of({ live: false, gaps: [] }));
		const { page, toasts } = render({ setStatus });
		TestBed.tick();
		page.bulkTakeDown(['a', 'b']);
		expect(toasts.showSuccess).toHaveBeenCalledWith('blog_bulk_taken_down');
		expect(toasts.showError).not.toHaveBeenCalled();
		setStatus.mockReturnValue(throwError(() => new Error('refused')) as never);
		page.bulkTakeDown(['b']);
		expect(toasts.showSuccess).toHaveBeenCalledTimes(1);
		expect(toasts.showError).toHaveBeenCalledWith('blog_rejected');
		posts.value = undefined;
	});

	it('finds ticked posts when the table holds no rows yet', () => {
		const { page, toasts } = render({ goLive: vi.fn() });
		page.tableConfig.update((config) => ({ ...config, data: undefined as never }));
		page.bulkGoLive(['a']);
		expect(toasts.showError).not.toHaveBeenCalled();
	});
});
