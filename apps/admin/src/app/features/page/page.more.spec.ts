import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { LegalPagesGateway } from '@core/legal-pages/legal-pages.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { FormPage, refusedFields } from './form-page/form-page';
import { Page } from './page';

const row = (over: Record<string, unknown> = {}) => ({
	page: {
		slug: 'privacy-policy',
		title: { en: 'Privacy Policy' },
		content: { en: '<p>Text</p>' },
		metaTitle: {},
		metaDescription: {},
		metaImageAssetId: 'med_share',
		version: 3,
		updatedAt: '2026-11-15T10:00:00.000Z',
		updatedBy: 'adm_1',
		...over,
	},
	updatedByName: 'Moulik',
	gaps: {},
	metaImageUrl: 'https://cdn.test/share.jpg',
});

const apiRefusal = (body: unknown) => new HttpErrorResponse({ status: 400, error: body });

function form(gateway: Record<string, unknown>, platform = 'server', id: string | null = 'privacy-policy') {
	const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: LegalPagesGateway, useValue: gateway },
			{ provide: ActivatedRoute, useValue: { snapshot: { params: id ? { id } : {}, queryParams: {} } } },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'] } },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(FormPage, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(FormPage).componentInstance, toasts };
}

describe('a legal page’s form: loading and the share picture', () => {
	it('has an editor in the browser, and reads the share picture with no stored version', async () => {
		const { page } = form({ get: () => of(row()) }, 'browser');
		expect(page.editor).not.toBeNull();
		page.editor?.destroy();
		await vi.waitFor(() => expect(page.row()).not.toBeNull());
		expect(page.metaImage()).toMatchObject({
			id: 'med_share',
			original_url: 'https://cdn.test/share.jpg',
			versionId: null,
		});
		page.selectMetaImage(null);
		expect(page.metaImage()).toBeNull();
		page.selectMetaImage({ id: 'med_2', versionId: 'v4' } as never);
		expect(page.metaImage()).toMatchObject({ id: 'med_2', versionId: 'v4' });
	});

	it('says why a page did not open, in the API’s words or its own', async () => {
		const worded = form({
			get: () => throwError(() => apiRefusal({ code: 'not_found', message: 'No such page.' })),
		});
		await vi.waitFor(() => expect(worded.toasts.showError).toHaveBeenCalledWith('No such page.'));
		const plain = form({ get: () => throwError(() => new Error('offline')) });
		await vi.waitFor(() => expect(plain.toasts.showError).toHaveBeenCalledWith('fm_action_failed'));
	});

	it('opens nothing without an address, and refuses to save before a page has loaded', async () => {
		const save = vi.fn();
		const { page } = form({ get: vi.fn(), save }, 'server', null);
		await page.submit();
		expect(save).not.toHaveBeenCalled();
	});
});

describe('a legal page’s form: the alert lines and saving', () => {
	it('opens the language and field a line names, and names the field', async () => {
		const { page } = form({ get: () => of(row()) });
		await vi.waitFor(() => expect(page.row()).not.toBeNull());
		page.openGap({ locale: 'bn', field: 'content' });
		expect(page.fields.locale()).toBe('bn');
		page.openGap({ locale: 'en', field: 'slug' });
		page.openLanguageGap({ key: 'title', locale: 'bn' });
		expect(page.fields.locale()).toBe('bn');
		expect(page.gapLabel({ locale: 'bn', field: 'content' })).toContain('content');
		expect(page.gapLabel({ locale: 'bn', field: 'title' })).toContain('title');
	});

	it('saves once at a time, and says why a save was refused when no field is named', async () => {
		let answer = () => throwError(() => apiRefusal({ code: 'conflict', message: 'Changed by someone else.' }));
		const save = vi.fn(() => answer());
		const { page, toasts } = form({ get: () => of(row()), save });
		await vi.waitFor(() => expect(page.row()).not.toBeNull());
		await page.submit();
		expect(toasts.showError).toHaveBeenLastCalledWith('Changed by someone else.');
		answer = () => throwError(() => new Error('offline'));
		await page.submit();
		expect(toasts.showError).toHaveBeenLastCalledWith('fm_action_failed');
		page.saving.set(true);
		await page.submit();
		expect(save).toHaveBeenCalledTimes(2);
		page.saving.set(false);
		answer = () => of(row({ version: 4 })) as never;
		await page.submit();
		expect(toasts.showSuccess).toHaveBeenCalledWith('page_saved');
		expect(page.row()?.page.version).toBe(4);
	});

	it('reads a refusal issue with no path as naming nothing', () => {
		expect(refusedFields(apiRefusal({ error: { issues: [{ code: 'legal_page_incomplete' }] } }))).toEqual([
			{ field: '', locale: '' },
		]);
	});
});

describe('the Pages list', () => {
	const list = (pages: unknown[] | 'fails', query: Record<string, string> = {}) => {
		const router = { navigate: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: LegalPagesGateway,
					useValue: { list: () => (pages === 'fails' ? throwError(() => new Error('offline')) : of(pages)) },
				},
				{ provide: ActivatedRoute, useValue: { snapshot: { queryParams: query } } },
				{ provide: Router, useValue: router },
			],
		});
		TestBed.overrideComponent(Page, { set: { imports: [], template: '' } });
		return { pages: TestBed.createComponent(Page).componentInstance, router };
	};

	it('names a page with no English title by its address, and opens it plainly', async () => {
		const { pages, router } = list([row({ title: {} })]);
		await vi.waitFor(() => expect(pages.tableConfig().data).toHaveLength(1));
		expect(pages.tableConfig().data[0]).toMatchObject({ title: 'privacy-policy' });
		pages.onActionClicked({ actionToPerform: 'edit', data: pages.tableConfig().data[0] } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/page/edit', 'privacy-policy'], {});
	});

	it('lists only the pages missing the language asked for, and keeps it when opening one', async () => {
		const { pages, router } = list([row(), { ...row({ slug: 'terms' }), gaps: { bn: ['content'] } }], {
			missing: 'bn',
		});
		await vi.waitFor(() => expect(pages.tableConfig().data).toHaveLength(1));
		pages.edit(pages.tableConfig().data[0] as never);
		expect(router.navigate).toHaveBeenCalledWith(['/page/edit', 'terms'], { queryParams: { missing: 'bn' } });
		pages.onActionClicked({ actionToPerform: 'view', data: {} } as never);
		expect(router.navigate).toHaveBeenCalledTimes(1);
	});

	it('shows no pages when the list cannot be read', async () => {
		const { pages } = list('fails');
		await Promise.resolve();
		expect(pages.tableConfig().data).toEqual([]);
	});
});
