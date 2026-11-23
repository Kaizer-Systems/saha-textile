import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CompanyProfileSettings } from './company-profile';

import type { CompanyProfile } from '@saha-textile/contracts';

const profile = (patch: Partial<CompanyProfile> = {}): CompanyProfile => ({
	kind: 'proprietorship',
	legalName: 'K.R. Marketing',
	tradeName: 'Saha Textile',
	pan: 'DBYPS6736R',
	tan: null,
	cin: null,
	llpin: null,
	udyam: null,
	financialYearStartMonth: 4,
	booksStartOn: null,
	homeCurrency: 'INR',
	proprietor: null,
	otherBusinesses: [],
	partners: [],
	partnersCapital: 'fixed_with_current',
	directors: [],
	shareholders: [],
	authorisedCapitalINR: 0,
	paidUpCapitalINR: 0,
	faceValueINR: 10,
	nomineeName: null,
	revision: 1,
	updatedAt: '2026-11-23T10:00:00.000Z',
	updatedBy: null,
	...patch,
});

function setup(
	current: CompanyProfile | null,
	permissions = ['setting.index', 'company.edit'],
	options: { booksSetUp?: boolean; failSave?: boolean } = {},
) {
	const gateway = {
		profile: vi.fn(() => (current ? of(current) : NEVER)),
		saveProfile: vi.fn(() => (options.failSave ? throwError(() => new Error('down')) : of(current))),
	};
	const opens = {
		charts: [
			{ code: 'CH-COMMON', name: 'Shared chart', version: 2 },
			{ code: 'CH-PROP', name: 'Proprietor', version: 1 },
		],
		taxRules: [{ code: 'RS-RCM', name: 'Reverse-charge list', version: 1, entries: 4 }],
		reports: [],
		locked: 4,
		booksSetUp: options.booksSetUp ?? false,
	};
	const templates = { opens: vi.fn(() => of(opens)), setUpBooks: vi.fn(() => of([])) };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [CompanyProfileSettings, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: CompanyGateway, useValue: gateway },
			{ provide: AccountsTemplatesGateway, useValue: templates },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(CompanyProfileSettings);
	return { fixture, page: fixture.componentInstance, gateway, templates, notifier };
}
const settle = async (fixture: ReturnType<typeof setup>['fixture']) => {
	for (let i = 0; i < 4; i++) {
		await new Promise((r) => setTimeout(r, 0));
		fixture.detectChanges();
	}
};

describe('Settings › Company (accounts brief J1, CT1–CT6)', () => {
	it('offers five kinds with public limited switched off, and says what the kind sets', async () => {
		const { fixture, page } = setup(profile());
		await settle(fixture);
		const el: HTMLElement = fixture.nativeElement;
		expect(el.querySelectorAll('input[name="co_kind"]').length).toBe(5);
		expect(page.effects()?.incomeTaxReturn).toBe('ITR-3');
		expect(page.problems()).toEqual(['proprietor_needed']);
		expect((el.querySelector('#co_save') as HTMLButtonElement).disabled).toBe(true);
	});

	it('a partnership needs two partners whose shares make 100%, then saves with the copy read', async () => {
		const { fixture, page, gateway } = setup(profile());
		await settle(fixture);
		page.pickKind('partnership');
		page.addPartner();
		page.addPartner();
		const [a, b] = page.form()!.partners;
		page.patchPartner(a!.id, { name: 'Partner A', pan: 'ABCDE1234F', profitSharePercent: 60 });
		page.patchPartner(b!.id, { name: 'Partner B', pan: 'ABCDE1235F', profitSharePercent: 30 });
		expect(page.problems()).toContain('partner_shares_total_100');
		page.patchPartner(b!.id, { profitSharePercent: 40 });
		expect(page.problems()).toEqual([]);
		await page.save();
		expect(gateway.saveProfile).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'partnership' }),
			'2026-11-23T10:00:00.000Z',
		);
	});

	it('is read-only without company.edit', async () => {
		const { fixture } = setup(profile(), ['setting.index']);
		await settle(fixture);
		expect(fixture.nativeElement.querySelector('#co_save')).toBeNull();
	});

	it('says what the kind opens, sets up the books with the first save, then keeps the kind (AT1, AT-D3)', async () => {
		const owner = { proprietor: { name: 'Owner', pan: 'ABCPS1234D', openingCapitalINR: 0 } };
		const fresh = setup(profile(owner), ['setting.index', 'company.edit', 'accounts_template.edit']);
		expect(fresh.page.booksSetUp()).toBe(false);
		await settle(fresh.fixture);
		expect(fresh.fixture.nativeElement.querySelector('#co_opens')?.textContent).toContain('Shared chart v2');
		await fresh.page.save();
		expect(fresh.templates.setUpBooks).toHaveBeenCalledTimes(1);
		const noRight = setup(profile(owner));
		await settle(noRight.fixture);
		await noRight.page.save();
		expect(noRight.templates.setUpBooks).not.toHaveBeenCalled();
		const set = setup(profile(owner), ['setting.index', 'company.edit', 'accounts_template.edit'], {
			booksSetUp: true,
		});
		await settle(set.fixture);
		expect(set.page.booksSetUp()).toBe(true);
		set.page.pickKind('llp');
		expect(set.page.form()?.kind).toBe('proprietorship');
		await set.page.save();
		expect(set.templates.setUpBooks).not.toHaveBeenCalled();
		const refused = setup(profile(owner), ['setting.index', 'company.edit'], { failSave: true });
		await settle(refused.fixture);
		await refused.page.save();
		expect(refused.notifier.showError).toHaveBeenCalled();
		expect(refused.page.saving()).toBe(false);
	});

	it('edits owners, directors, shareholders and other businesses, and does nothing before the profile is read', async () => {
		const { page, gateway } = setup(null);
		expect([page.effects(), page.problems(), page.shareTotal(), page.totalShares()]).toEqual([null, [], 0, 0]);
		page.addPartner();
		page.patchPartner('x', {});
		page.removePartner('x');
		page.addDirector();
		page.patchDirector('x', {});
		page.removeDirector('x');
		page.addShareholder();
		page.patchShareholder('x', {});
		page.removeShareholder('x');
		page.addOtherBusiness();
		page.patchOtherBusiness(0, {});
		page.removeOtherBusiness(0);
		page.setProprietor({ name: 'A' });
		await page.save();
		expect([page.form(), gateway.saveProfile.mock.calls.length]).toEqual([null, 0]);
		// Read before the profile arrives: the copy on the form decides which save it is over.
		page.form.set(
			profile({ updatedAt: null, proprietor: { name: 'Owner', pan: 'ABCPS1234D', openingCapitalINR: 0 } }),
		);
		await page.save();
		expect(gateway.saveProfile).toHaveBeenLastCalledWith(expect.anything(), null);
		page.form.set(profile({ proprietor: { name: 'Owner', pan: 'ABCPS1234D', openingCapitalINR: 0 } }));
		await page.save();
		expect(gateway.saveProfile).toHaveBeenLastCalledWith(expect.anything(), '2026-11-23T10:00:00.000Z');
		page.setProprietor({ openingCapitalINR: 5 });
		expect(page.form()?.proprietor).toMatchObject({ name: 'Owner', openingCapitalINR: 5 });
		page.form.set(profile());
		page.setProprietor({ name: 'New' });
		expect(page.form()?.proprietor?.name).toBe('New');
		page.addDirector();
		page.addDirector();
		const [d1, d2] = page.form()!.directors;
		page.patchDirector(d1!.id, { name: 'Director One' });
		expect(page.form()!.directors.map((d) => d.name)).toEqual(['Director One', '']);
		page.removeDirector(d2!.id);
		page.addShareholder();
		page.addShareholder();
		const [h1, h2] = page.form()!.shareholders;
		page.patchShareholder(h1!.id, { shares: 9 });
		expect(page.totalShares()).toBe(10);
		page.removeShareholder(h2!.id);
		page.addPartner();
		page.addPartner();
		const [p1, p2] = page.form()!.partners;
		page.patchPartner(p1!.id, { profitSharePercent: 70 });
		expect(page.shareTotal()).toBe(70);
		page.removePartner(p2!.id);
		page.addOtherBusiness();
		page.addOtherBusiness();
		page.patchOtherBusiness(1, { tradeName: 'Second' });
		expect(page.form()!.otherBusinesses.map((b) => b.tradeName)).toEqual(['', 'Second']);
		page.removeOtherBusiness(0);
		expect(page.form()!.otherBusinesses).toHaveLength(1);
		expect([page.text('  ab1 '), page.text('  ')]).toEqual(['AB1', null]);
		expect([page.num('5'), page.num('x'), page.num(-1)]).toEqual([5, 0, 0]);
		expect([
			page.isCompany('private_limited_opc'),
			page.isCompany('llp'),
			page.isFirm('llp'),
			page.isFirm('private_limited'),
		]).toEqual([true, false, true, false]);
	});

	it('does not change the kind without company.edit', async () => {
		const { fixture, page } = setup(profile(), ['setting.index']);
		await settle(fixture);
		page.pickKind('llp');
		expect(page.form()?.kind).toBe('proprietorship');
		await page.save();
	});
});
