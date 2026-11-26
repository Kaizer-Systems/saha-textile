import type { ReportFilterOp } from './report-engine';

/**
 * Brief 26 AU2 (approved 2026-11-26): the starting audit reports, each a saved report on the audit trail source with
 * a code. They read the actions the admin writes today; every one can be opened, run for any period and saved as a
 * copy to change. Filters are joined with "and", as everywhere in the report builder.
 */
export interface AuditReportTemplate {
	code: string;
	name: string;
	/** For this business, or for any business. */
	kind: 'business' | 'any';
	columns: readonly string[];
	filters: readonly { field: string; op: ReportFilterOp; values: readonly string[] }[];
	groupBy: readonly string[];
	totals: readonly string[];
	sort: { field: string; direction: 'asc' | 'desc' } | null;
}

const LIST = ['date', 'time', 'who', 'action', 'record', 'field', 'before', 'after', 'reason'] as const;
const newestFirst = { field: 'date', direction: 'desc' } as const;
const template = (
	code: string,
	name: string,
	kind: AuditReportTemplate['kind'],
	filters: AuditReportTemplate['filters'],
	over: Partial<Pick<AuditReportTemplate, 'columns' | 'groupBy' | 'totals' | 'sort'>> = {},
): AuditReportTemplate => ({
	code,
	name,
	kind,
	filters,
	columns: over.columns ?? LIST,
	groupBy: over.groupBy ?? [],
	totals: over.totals ?? [],
	sort: over.sort === undefined ? newestFirst : over.sort,
});
const actionIn = (...values: string[]) => [{ field: 'action', op: 'in' as const, values }];
const moduleIn = (...values: string[]) => [{ field: 'module', op: 'in' as const, values }];

export const AUDIT_REPORT_TEMPLATES: readonly AuditReportTemplate[] = [
	// For this business.
	template(
		'AR-PRICE',
		'Price changes',
		'business',
		[
			{ field: 'action', op: 'is', values: ['catalog.product.save'] },
			{ field: 'field', op: 'contains', values: ['price'] },
		],
		{
			columns: ['date', 'time', 'who', 'record', 'field', 'before', 'after', 'changePercent'],
			sort: { field: 'changePercent', direction: 'desc' },
		},
	),
	template(
		'AR-STOCK',
		'Stock write-offs, adjustments, counts and transfers',
		'business',
		moduleIn('stock', 'transfer'),
	),
	template(
		'AR-CANCEL',
		'Cancelled, voided and reversed',
		'business',
		actionIn(
			'purchase.order.cancel',
			'purchase.entry.void',
			'purchase.payment.reverse',
			'accounts.voucher.reverse',
			'accounts.import.undo',
			'stock.adjustment.reverse',
			'transfer.cancel',
			'event.sale.cancel',
		),
	),
	template(
		'AR-LOCK',
		'Periods locked and returns filed',
		'business',
		actionIn('accounts.period.lock', 'accounts.gst.filed', 'attendance.month.lock'),
	),
	template('AR-RETURN', 'Returns and refunds', 'business', moduleIn('returns')),
	template('AR-CASH', 'Cash sheets, differences and cash paid out', 'business', moduleIn('cash')),
	template(
		'AR-PAY',
		'Payroll: payslip edits, salary changes and attendance',
		'business',
		moduleIn('payroll', 'attendance'),
	),
	template(
		'AR-PARTY',
		'Supplier, bank and business details changed',
		'business',
		actionIn(
			'purchase.supplier.create',
			'purchase.supplier.update',
			'purchase.supplier.delete',
			'bank.rule.save',
			'shop_details.update',
			'shop_details.suppliers_retaxed',
		),
	),
	// For any business.
	template(
		'AR-ACCESS',
		'Passwords, PINs and invitations',
		'any',
		actionIn(
			'admin.security.password.change',
			'admin.security.pin.set',
			'admin.security.pin.change',
			'admin.security.pin.remove',
			'admin.invite.create',
			'admin.invite.accept',
			'admin.invite.revoke',
		),
		{ columns: ['date', 'time', 'weekday', 'who', 'action', 'record'] },
	),
	template(
		'AR-ROLE',
		'Users and roles: who was given or lost which permission',
		'any',
		actionIn(
			'admin.user.role.assign',
			'admin.user.role.revoke',
			'admin.role.create',
			'admin.role.update',
			'admin.role.delete',
			'admin.user.status.change',
			'media.role.update',
		),
	),
	template(
		'AR-APPROVE',
		'Approvals, by who approved',
		'any',
		[{ field: 'action', op: 'contains', values: ['approve'] }],
		{
			columns: ['who', 'action', 'changes'],
			groupBy: ['who', 'action'],
			totals: ['changes'],
			sort: { field: 'changes', direction: 'desc' },
		},
	),
	template('AR-EXPORT', 'Data exported', 'any', [{ field: 'action', op: 'contains', values: ['export'] }], {
		columns: ['date', 'time', 'who', 'action', 'record'],
	}),
	template('AR-DELETE', 'Deleted records', 'any', [{ field: 'action', op: 'contains', values: ['delete'] }], {
		columns: ['date', 'time', 'who', 'action', 'record', 'reason'],
	}),
	template(
		'AR-SETTING',
		'Settings changed',
		'any',
		actionIn(
			'purchase.settings.update',
			'shipping_settings.save',
			'shipping_rule_set.activate',
			'cash.settings.save',
			'fx.settings.update',
			'payments.routing.update',
			'payroll.rules.add',
			'communication.switch.change',
			'notification.channel.toggle',
			'notification.template.upsert',
			'page_builder.settings.save',
			'storefront.settings.share',
			'storefront.settings.search',
			'media.storage.settings',
			'language.add',
			'language.admin.switch',
			'language.shop.switch',
			'company.convert',
			'accounts.template.install',
			'accounts.role.point',
		),
	),
];
