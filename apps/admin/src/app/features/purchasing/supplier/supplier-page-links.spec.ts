import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { SupplierPage, statementLink } from './supplier-page';

const actions = vi.hoisted(() => ({
	exportSupplierStatement: vi.fn(),
	recordSupplierPayment: vi.fn(async () => undefined),
}));
vi.mock('../shared/supplier-actions', () => actions);

/** The supplier page (s03), with self-invoices and their vouchers on the statement (accounts brief D). */

const row = (kind: string) => ({ kind, documentId: 'doc_1' }) as never;
const summary = (taxType: string) => ({
	supplier: { id: 'sup_1', paymentTermsDays: taxType === 'none' ? 0 : 30, taxType },
	statement: [
		{ kind: 'bill', documentId: 'pe_1' },
		{ kind: 'payment', documentId: 'pe_1' },
		{ kind: 'payment_reversed', documentId: 'pe_1' },
		{ kind: 'self_invoice', documentId: 'si_1' },
	],
});

function setup(options: { id?: string | null; taxType?: string; permissions?: string[] } = {}) {
	const router = { navigate: vi.fn() };
	const gateway = {
		supplierSummary: vi.fn(() => of(summary(options.taxType ?? 'intra_state'))),
		entries: vi.fn(() => of({ items: [], total: 0 })),
		returns: vi.fn(() => of({ items: [], total: 0 })),
		supplierActivity: vi.fn(() => of([])),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [SupplierPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(options.id === null ? {} : { id: 'sup_1' }) } },
			},
			{ provide: Router, useValue: router },
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: StockGateway, useValue: { settings: () => of({ unpaidAlertDays: 120 }) } },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['setting.index', 'purchase_return.index']) },
			},
		],
	});
	TestBed.overrideComponent(SupplierPage, { set: { template: '' } });
	const fixture = TestBed.createComponent(SupplierPage);
	return { fixture, page: fixture.componentInstance, router, gateway };
}

describe('the supplier page', () => {
	it('links every statement row to its document, self-invoices and their vouchers included', () => {
		expect(statementLink(row('self_invoice'))).toEqual(['/accounts/self-invoices', 'doc_1']);
		expect(statementLink(row('self_invoice_cancelled'))).toEqual(['/accounts/self-invoices', 'doc_1']);
		expect(statementLink(row('self_invoice_payment'))).toEqual(['/accounts/payment-vouchers', 'doc_1']);
		expect(statementLink(row('self_invoice_payment_cancelled'))).toEqual(['/accounts/payment-vouchers', 'doc_1']);
		for (const kind of ['bill', 'payment', 'payment_reversed'])
			expect(statementLink(row(kind))).toEqual(['/purchase-entries', 'doc_1']);
		for (const kind of ['debit_note', 'credit_note', 'refund_received', 'claim_written_off'])
			expect(statementLink(row(kind))).toEqual(['/purchase-returns', 'doc_1']);
		expect(statementLink(row('something_else'))).toBeNull();
	});

	it('reads the supplier, its terms and tax, payments, each tab, and the alert days', async () => {
		const { fixture, page, gateway, router } = setup();
		expect([page.supplier(), page.terms(), page.taxKey(), page.payments(), page.alertDays()]).toEqual([
			null,
			'',
			'tax_none',
			[],
			150,
		]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.supplier()).toBeTruthy());
		await vi.waitFor(() => expect(page.alertDays()).toBe(120));
		expect(page.terms()).toBeTruthy();
		expect(page.taxKey()).toBe('tax_cgst_sgst');
		expect(page.payments().map((r) => r.kind)).toEqual(['payment', 'payment_reversed']);
		expect(page.link).toBe(statementLink);
		for (const tab of ['purchases', 'returns', 'activity'] as const) {
			page.tab.set(tab);
			fixture.detectChanges();
		}
		await vi.waitFor(() => expect(gateway.supplierActivity).toHaveBeenCalledWith('sup_1'));
		expect(gateway.entries).toHaveBeenCalled();
		expect(gateway.returns).toHaveBeenCalled();
		page.edit();
		expect(router.navigate).toHaveBeenCalledWith(['/suppliers', 'sup_1', 'edit']);
		page.exportStatement();
		expect(actions.exportSupplierStatement).toHaveBeenCalledTimes(1);
		await page.recordPayment();
		expect(actions.recordSupplierPayment).toHaveBeenCalledWith(
			'sup_1',
			expect.objectContaining({ t: expect.any(Function) }),
		);
		const t = (actions.recordSupplierPayment.mock.calls[0] as unknown as [string, { t: (k: string) => string }])[1]
			.t;
		expect(t('x')).toContain('x');
		const exported = actions.exportSupplierStatement.mock.calls[0] as unknown as [unknown, (k: string) => string];
		expect(exported[1]('y')).toContain('y');
	});

	it('reads the other tax kinds, and does nothing to export before the summary arrives', async () => {
		for (const [taxType, key] of [
			['inter_state', 'tax_igst'],
			['none', 'tax_none'],
		]) {
			const { fixture, page } = setup({ taxType });
			fixture.detectChanges();
			await vi.waitFor(() => expect(page.supplier()).toBeTruthy());
			expect(page.taxKey()).toBe(key);
			expect(page.terms()).toBeTruthy();
		}
		const empty = setup({ id: null, permissions: [] });
		expect(empty.page.id()).toBe('');
		empty.page.exportStatement();
		expect(actions.exportSupplierStatement).not.toHaveBeenCalled();
	});
});
