import { z } from 'zod';

import { I18nString, Id, IsoDateTime, PriceINR } from './common';
import { StoredOrderStatus } from './order';
import { ReviewStatus } from './content';

/**
 * Admin home page widgets (`DEC-ADMIN-HOME-WIDGETS`).
 *
 * TEMPORARY SHAPES. Every response below exists to get the home page onto real data during
 * the API build. They will change once the order, stock and report screens settle what these
 * figures should carry, so nothing outside the home page should depend on them.
 *
 * What the owner closed on 2026-11-07, and which stays true when the shapes change:
 *
 *   - Revenue is the amount paid: `totalINR` of purchased orders, with shipping and after
 *     discounts. The owner may revisit this later.
 *   - The Revenue and Orders tiles default to the last 12 months and each carries its own
 *     period choice.
 *   - Each widget has its own permission, enforced by the API.
 */

/** A custom period may span at most this many months, so no request can read everything. */
export const DASHBOARD_CUSTOM_RANGE_MAX_MONTHS = 24;

/** How many rows the home page lists. The API returns no more than this. */
export const DASHBOARD_LIST_LIMITS = { recentOrders: 5, topProducts: 4, stock: 8, reviews: 4 } as const;

/**
 * The periods the home page offers.
 *
 * The tiles use `last_12_months` to `custom`. `today`, `last_week` and `this_year` are the
 * Top Selling Products filter, which was already on the page.
 */
export const DashboardPeriod = z.enum([
	'last_12_months',
	'last_30_days',
	'last_month',
	'last_quarter',
	'current_quarter',
	'custom',
	'today',
	'last_week',
	'this_year',
]);
export type DashboardPeriod = z.infer<typeof DashboardPeriod>;

/** A calendar day, read as a day in India. */
const CalendarDay = z.iso.date();

function monthsBetween(from: string, to: string): number {
	const [fromYear = 0, fromMonth = 0, fromDay = 0] = from.split('-').map(Number);
	const [toYear = 0, toMonth = 0, toDay = 0] = to.split('-').map(Number);
	const months = (toYear - fromYear) * 12 + (toMonth - fromMonth);
	return toDay > fromDay ? months + 1 : months;
}

/** `?period=` plus, for `custom` only, `from` and `to` as calendar days. */
export const DashboardPeriodQuery = z
	.object({
		period: DashboardPeriod.default('last_12_months'),
		from: CalendarDay.optional(),
		to: CalendarDay.optional(),
	})
	.superRefine((query, ctx) => {
		if (query.period !== 'custom') return;
		if (!query.from || !query.to) {
			ctx.addIssue({ code: 'custom', message: 'a custom period needs a start and an end', path: ['from'] });
			return;
		}
		if (query.from > query.to) {
			ctx.addIssue({ code: 'custom', message: 'the start must not be after the end', path: ['from'] });
			return;
		}
		if (monthsBetween(query.from, query.to) > DASHBOARD_CUSTOM_RANGE_MAX_MONTHS) {
			ctx.addIssue({
				code: 'custom',
				message: `a custom period can cover at most ${DASHBOARD_CUSTOM_RANGE_MAX_MONTHS} months`,
				path: ['to'],
			});
		}
	});
export type DashboardPeriodQuery = z.infer<typeof DashboardPeriodQuery>;

/** `?categoryId=` on the stock report. */
export const DashboardStockQuery = z.object({ categoryId: Id.optional() });
export type DashboardStockQuery = z.infer<typeof DashboardStockQuery>;

/** TEMPORARY SHAPE. The range actually read: `from` inclusive, `to` exclusive. */
export const DashboardRange = z.object({ from: IsoDateTime, to: IsoDateTime });
export type DashboardRange = z.infer<typeof DashboardRange>;

/** TEMPORARY SHAPE. `GET /admin/dashboard/revenue`. */
export const DashboardRevenueResponse = DashboardRange.extend({ revenueINR: PriceINR });
export type DashboardRevenueResponse = z.infer<typeof DashboardRevenueResponse>;

/** TEMPORARY SHAPE. `GET /admin/dashboard/orders`. */
export const DashboardOrdersResponse = DashboardRange.extend({ orders: z.number().int().nonnegative() });
export type DashboardOrdersResponse = z.infer<typeof DashboardOrdersResponse>;

/** TEMPORARY SHAPE. `GET /admin/dashboard/revenue/monthly`: 12 months, oldest first, gaps as 0. */
export const DashboardMonthlyRevenueResponse = z.object({
	months: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), revenueINR: PriceINR })),
});
export type DashboardMonthlyRevenueResponse = z.infer<typeof DashboardMonthlyRevenueResponse>;

/** TEMPORARY SHAPE. `GET /admin/dashboard/orders/recent`. */
export const DashboardRecentOrdersResponse = z.object({
	items: z.array(
		z.object({
			id: Id,
			orderNumber: z.string().min(1),
			placedAt: IsoDateTime.nullable(),
			customerName: z.string().nullable(),
			totalINR: PriceINR,
			status: StoredOrderStatus,
		}),
	),
});
export type DashboardRecentOrdersResponse = z.infer<typeof DashboardRecentOrdersResponse>;

/** TEMPORARY SHAPE. `GET /admin/dashboard/customers`: everyone but deleted accounts. */
export const DashboardCustomersResponse = z.object({ customers: z.number().int().nonnegative() });
export type DashboardCustomersResponse = z.infer<typeof DashboardCustomersResponse>;

/** TEMPORARY SHAPE. `GET /admin/dashboard/top-products`. */
export const DashboardTopProductsResponse = z.object({
	items: z.array(
		z.object({
			productId: Id,
			title: I18nString,
			thumbnailUrl: z.string().nullable(),
			lastSoldAt: IsoDateTime,
			unitPriceINR: PriceINR,
			orders: z.number().int().nonnegative(),
			quantitySold: z.number().int().nonnegative(),
			revenueINR: PriceINR,
			stock: z.number().int(),
		}),
	),
});
export type DashboardTopProductsResponse = z.infer<typeof DashboardTopProductsResponse>;

export const DashboardStockState = z.enum(['out_of_stock', 'low_stock', 'in_stock']);
export type DashboardStockState = z.infer<typeof DashboardStockState>;

/** TEMPORARY SHAPE. `GET /admin/dashboard/stock`: live variants, lowest stock first. */
export const DashboardStockResponse = z.object({
	items: z.array(
		z.object({
			variantId: Id,
			productId: Id,
			sku: z.string().min(1),
			title: I18nString,
			thumbnailUrl: z.string().nullable(),
			quantity: z.number().int(),
			state: DashboardStockState,
		}),
	),
});
export type DashboardStockResponse = z.infer<typeof DashboardStockResponse>;

/** TEMPORARY SHAPE. `GET /admin/dashboard/reviews`: newest first, in any moderation state. */
export const DashboardReviewsResponse = z.object({
	items: z.array(
		z.object({
			id: Id,
			productTitle: I18nString.nullable(),
			thumbnailUrl: z.string().nullable(),
			customerName: z.string().nullable(),
			rating: z.number().int().min(1).max(5),
			status: ReviewStatus,
			createdAt: IsoDateTime.nullable(),
		}),
	),
});
export type DashboardReviewsResponse = z.infer<typeof DashboardReviewsResponse>;
