import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BlogService } from '@data-access/services/blog.service';
import { NotificationService } from '@data-access/services/notification.service';

import { FormBlog } from './form-blog';

vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown) => (p(), { data: signal(undefined) }),
}));
vi.mock('@data-access/queries/tag.queries', () => ({
	injectTagsQuery: (p: () => unknown) => (p(), { data: signal(undefined) }),
}));

const row = {
	post: {
		id: 'blg_1',
		slug: 'real-banarasi',
		title: { en: 'Real Banarasi' },
		excerpt: {},
		content: { en: '<p>Checks</p>' },
		coverAssetId: null,
		shareImageAssetId: 'med_share',
		imageVersions: { med_share: 'v2' },
		categoryIds: [],
		tagIds: [],
		featured: false,
		sticky: false,
		author: {},
		publishedAt: '2026-11-07T20:00:00.000Z',
		seoTitle: {},
		seoDescription: {},
		status: 'draft',
	},
	cover: null,
	shareImage: { id: 'med_share', url: 'https://cdn/s' },
};

function render() {
	const blogs = { getPost: vi.fn(() => of(row)), savePost: vi.fn(() => of(row)) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: BlogService, useValue: blogs },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
			{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject({ id: 'blg_1' }) } },
			{ provide: PLATFORM_ID, useValue: 'server' },
		],
	});
	TestBed.overrideComponent(FormBlog, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(FormBlog);
	fixture.detectChanges();
	TestBed.tick();
	return { page: fixture.componentInstance, blogs };
}

describe('a blog post with no cover', () => {
	it('opens with empty cover texts, the share picture’s version, and sends what the boxes hold', () => {
		const { page, blogs } = render();
		expect(page.cover).toBeNull();
		expect(page.shareImage).toMatchObject({ id: 'med_share', versionId: 'v2' });
		expect(page.form.value).toMatchObject({ blog_thumbnail_id: '', cover_alt: '' });
		page.form.patchValue({ published_at: null, categories: null, blog_thumbnail_id: null } as never);
		page.submit();
		expect(blogs.savePost).toHaveBeenCalledWith(
			'blg_1',
			expect.objectContaining({
				coverAssetId: null,
				shareImageAssetId: 'med_share',
				categoryIds: [],
				publishedAt: null,
			}),
		);
	});

	it('opens a Go Live line for the whole post at the title, in the language shown', () => {
		const { page } = render();
		page.switchLanguage('bn');
		page.openGap({ field: 'something_new', locale: null });
		expect(page.fields.locale()).toBe('bn');
	});
});
