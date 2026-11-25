import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EDocsGateway } from '@core/edocs/edocs.gateway';

import { EDocActivityPage } from './edoc-activity';

import type { EDocCall } from '@saha-textile/contracts';

/** Settings › E-invoice and e-way bill › Activity (addendum 2, EI14, AE7): every call and by-hand entry, newest first. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const call = (id: string, over: Partial<EDocCall> = {}): EDocCall =>
	({
		id,
		at: '2026-11-25T06:30:00.000Z',
		gstin: '19AAPFU0939F1ZV',
		path: 'irpDirect',
		action: 'generate',
		documentNumber: 'INV/26-27/000123',
		ok: true,
		code: null,
		message: null,
		durationMs: 420,
		by: 'adm_1',
		...over,
	}) as EDocCall;

function mount(activity: ReturnType<typeof vi.fn>) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			EDocActivityPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: EDocsGateway, useValue: { activity } },
		],
	});
	const fixture = TestBed.createComponent(EDocActivityPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}
async function opened(activity: ReturnType<typeof vi.fn>) {
	const harness = mount(activity);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const rows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];

describe('the e-document activity log (EI14)', () => {
	it('lists each call with its path, action, document and result, and the reason when one failed', async () => {
		const { fixture } = await opened(
			vi.fn(() =>
				of({
					rows: [
						call('c1'),
						call('c2', { ok: false, code: 'ewb_2172', message: 'Distance too long', documentNumber: null }),
						call('c3', {
							path: 'manual',
							action: 'manualEntry',
							ok: false,
							code: null,
							message: 'typed wrong',
						}),
					],
					total: 3,
				}),
			),
		);
		const [done, failed, byHand] = rows(fixture);
		expect(done?.textContent).toContain('edoc_path_irpDirect_name');
		expect(done?.textContent).toContain('edoc_action_generate');
		expect(done?.textContent).toContain('INV/26-27/000123');
		expect(done?.querySelector('.status-success')?.textContent).toContain('edoc_result_ok');
		expect(done?.querySelector('small')).toBeNull();
		expect(failed?.querySelector('.status-danger')?.textContent).toContain('edoc_result_failed');
		expect(failed?.querySelector('small')?.textContent?.trim()).toBe('ewb_2172 · Distance too long');
		expect(failed?.textContent).toContain('—');
		expect(byHand?.querySelector('small')?.textContent?.trim()).toBe('· typed wrong');
		expect(el(fixture, '#edoc_down')).toBeNull();
		expect(el(fixture, '.pagination')).toBeNull();
	});

	it('warns that the by-hand pop-up is taking over when the newest automatic call got no answer', async () => {
		const { fixture, page } = await opened(
			vi.fn(() =>
				of({
					rows: [
						call('m1', { path: 'manual', action: 'manualEntry' }),
						call('c9', { ok: false, code: 'unavailable', at: '2026-11-25T07:00:00.000Z' }),
						call('c8'),
					],
					total: 3,
				}),
			),
		);
		expect(page.down()?.id).toBe('c9');
		expect(el(fixture, '#edoc_down')?.textContent).toContain('edoc_activity_down');
	});

	it('does not warn when the newest automatic call failed for another reason', async () => {
		const { page } = await opened(vi.fn(() => of({ rows: [call('c1', { ok: false, code: 'auth' })], total: 1 })));
		expect(page.down()).toBeNull();
	});

	it('pages fifty at a time and reads the page picked', async () => {
		const activity = vi.fn(() => of({ rows: [call('c1')], total: 120 }));
		const { fixture, page } = await opened(activity);
		const links = [...fixture.nativeElement.querySelectorAll('.page-link')] as HTMLElement[];
		expect(links.map((a) => a.textContent?.trim())).toEqual(['1', '2', '3']);
		expect(el(fixture, '.page-item.active')?.textContent?.trim()).toBe('1');
		links[2]?.click();
		await settle(fixture);
		expect(page.page()).toBe(3);
		expect(activity).toHaveBeenLastCalledWith(3);
	});

	it('says there is nothing yet, with one page, before and after an empty answer', async () => {
		const { fixture, page } = mount(vi.fn(() => of({ rows: [], total: 0 })));
		expect([page.rows(), page.pages(), page.down()]).toEqual([[], 1, null]);
		await settle(fixture);
		expect(rows(fixture)[0]?.textContent).toContain('edoc_activity_empty');
	});
});
