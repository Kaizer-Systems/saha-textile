import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { EXPENSE_BILL_KEYS, type ExpenseBillsGateway } from '@core/purchasing/expense-bills.gateway';
import { downloadCsv, shortDate } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { PaymentPopup, type PayableBill } from './payment-popup';

import type { SupplierSummary } from '@saha-textile/contracts';
import type { CsvWriter } from '@shared/ui/export-menu/export-menu';

/**
 * The supplier account's two actions, shared by Purchases › Suppliers and the business page's
 * "As supplier" tab (orders brief bz04: "the supplier statement already on Purchases › Suppliers,
 * shown here unchanged"), so both pages record payments and export statements the same way.
 */

/** The statement as a spreadsheet for the CA or the supplier (s03 Export statement). */
export function exportSupplierStatement(
	summary: SupplierSummary,
	t: (key: string) => string,
	save: CsvWriter = downloadCsv,
): void {
	const name = summary.supplier.shortName || summary.supplier.legalName;
	save(
		`statement-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`,
		[t('date'), t('document'), t('details'), t('bill_amount'), t('paid_or_credited'), t('balance')],
		summary.statement.map((row) => [
			shortDate(row.date),
			row.documentNumber,
			row.details,
			row.billINR || null,
			row.paidOrCreditedINR || null,
			row.balanceINR,
		]),
	);
}

/**
 * Record payment (s03): the same popup as on a purchase entry, with the unpaid bills to pick from: purchase entries and
 * posted expense bills (brief 25 EB1), oldest due first.
 */
export async function recordSupplierPayment(
	supplierId: string,
	deps: {
		gateway: PurchasingGateway;
		expenseBills: ExpenseBillsGateway;
		modals: NgbModal;
		notifier: NotificationService;
		queryClient: QueryClient;
		t: (key: string) => string;
	},
): Promise<void> {
	try {
		const [page, expenseBills] = await Promise.all([
			firstValueFrom(deps.gateway.entries({ supplierId, filter: 'unpaid', pageSize: 100, page: 1 })),
			firstValueFrom(deps.expenseBills.list({ status: 'posted', supplierId })),
		]);
		const entries = page.items
			.filter((row) => row.status === 'posted' && row.leftINR > 0.005)
			.map((row) => ({
				dueOn: row.dueOn,
				bill: {
					id: row.id,
					number: row.number ?? '',
					billNumber: row.billNumber,
					totalINR: row.totalINR,
					paidINR: row.paidINR,
					leftINR: row.leftINR,
				},
			}));
		const expenses = expenseBills
			.map((row) => ({ row, leftINR: Math.round((row.totalINR - row.paidINR) * 100) / 100 }))
			.filter(({ row, leftINR }) => row.supplierId === supplierId && leftINR > 0.005)
			.map(({ row, leftINR }) => ({
				// Bills saved before due dates were kept fall back to the bill date, as the supplier page does.
				dueOn: row.dueOn ?? row.billDate,
				bill: {
					id: row.id,
					number: row.number ?? '',
					billNumber: row.billNumber,
					totalINR: row.totalINR,
					paidINR: row.paidINR,
					leftINR,
					expenseBillVersion: row.version,
				},
			}));
		const bills: PayableBill[] = [...entries, ...expenses]
			// Oldest due first: that is the one to pay first.
			.sort((a, b) => a.dueOn.localeCompare(b.dueOn))
			.map(({ bill }) => bill);
		if (!bills.length) {
			deps.notifier.showSuccess(deps.t('supplier_nothing_to_pay'));
			return;
		}
		const popup = deps.modals.open(PaymentPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'payment_popup_title',
		});
		(popup.componentInstance as PaymentPopup).start(bills);
		const saved = await popup.result.catch(() => null);
		if (saved) {
			deps.notifier.showSuccess(deps.t('payment_saved'));
			void deps.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
			void deps.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.entries });
			void deps.queryClient.invalidateQueries({ queryKey: EXPENSE_BILL_KEYS.all });
		}
	} catch {
		// The list call failed; the global notice already said why.
	}
}
