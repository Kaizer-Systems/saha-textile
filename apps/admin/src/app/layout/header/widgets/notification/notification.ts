import { SlicePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { languageName } from '@saha-textile/core-domain/languages';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { shortDate } from '@core/purchasing/purchasing-format';
import {
	STOCK_ALERT_PERMISSIONS,
	STOCK_KEYS,
	StockGateway,
	injectStockAlertsQuery,
} from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { injectLanguageRemindersQuery } from '@data-access/queries/admin-languages.queries';
import { injectMediaStorageQuery, injectNightlyCheckQuery } from '@data-access/queries/media-library.queries';
import { injectNotificationsQuery } from '@data-access/queries/notification.queries';
import { injectPageBuilderAlertsQuery } from '@data-access/queries/page-builder.queries';
import { NavService } from '@data-access/services/nav.service';
import { quantityText } from '@features/purchasing/shared/purchasing-labels';
import { PluralPipe, pluralKey } from '@shared/pipes/language.pipes';
import { SummaryPipe } from '@shared/pipes/summary.pipe';

import type { StockAlerts } from '@core/purchasing/stock.gateway';

/** One stock line in the bell: what it says, where it opens, and what to mark seen. */
export interface StockBellLine {
	id: string;
	key: string;
	count: number | null;
	params: Record<string, unknown>;
	quantity: { units: number; soldBy: 'piece' | 'metre' } | null;
	link: string[];
	queryParams?: Record<string, string>;
	seenId: string | null;
}

/** The stock alerts as bell lines, most urgent first (i05, i05b, po01, unpaid bills, i06). */
export function stockBellLines(alerts: StockAlerts | undefined): StockBellLine[] {
	if (!alerts) return [];
	const lines: StockBellLine[] = [];
	if (alerts.pendingApprovals > 0) {
		lines.push({
			id: 'approvals',
			key: 'bell_approvals_waiting',
			count: alerts.pendingApprovals,
			params: {},
			quantity: null,
			link: ['/stock/approvals'],
			seenId: null,
		});
	}
	for (const decision of alerts.decisions) {
		const rejected = decision.status === 'rejected';
		const isCount = decision.kind === 'count';
		lines.push({
			id: `decision-${decision.id}`,
			key: isCount
				? rejected
					? 'bell_count_rejected'
					: 'bell_count_approved'
				: rejected
					? 'bell_request_rejected'
					: 'bell_request_approved',
			count: null,
			params: {
				name: decision.decidedByName ?? '',
				sku: decision.sku ?? '',
				number: decision.countNumber ?? '',
				reason: decision.rejectReason ?? '',
			},
			quantity: isCount ? null : { units: decision.quantity, soldBy: decision.soldBy },
			link:
				isCount && decision.countId
					? ['/stock-counts', decision.countId]
					: decision.variantId
						? ['/stock/items', decision.variantId]
						: ['/stock'],
			seenId: decision.id,
		});
	}
	for (const order of alerts.lateOrders) {
		lines.push({
			id: `late-${order.id}`,
			key: 'bell_order_late',
			count: null,
			params: { number: order.number, supplier: order.supplierName, date: order.expectedBy },
			quantity: null,
			link: ['/purchase-orders', order.id],
			seenId: null,
		});
	}
	if (alerts.billsNearCreditLimit.length) {
		lines.push({
			id: 'unpaid-bills',
			key: 'bell_unpaid_bills',
			count: alerts.billsNearCreditLimit.length,
			params: { days: Math.min(...alerts.billsNearCreditLimit.map((bill) => bill.days)) },
			quantity: null,
			link: ['/stock/reports'],
			queryParams: { tab: 'unpaid' },
			seenId: null,
		});
	}
	if (alerts.heldOverdue > 0) {
		lines.push({
			id: 'held-overdue',
			key: 'bell_held_overdue',
			count: alerts.heldOverdue,
			params: {},
			quantity: null,
			link: ['/stock/held'],
			seenId: null,
		});
	}
	return lines;
}

@Component({
	selector: 'app-notification',
	templateUrl: './notification.html',
	styleUrls: ['./notification.scss'],
	imports: [PluralPipe, RouterModule, SlicePipe, TranslocoModule, SummaryPipe],
})
export class Notification {
	navServices = inject(NavService);

	private readonly authStore = inject(AuthStore);
	private readonly notificationsQuery = injectNotificationsQuery();
	readonly notifications = computed(() => this.notificationsQuery.data()?.data ?? []);
	/**
	 * Deleted languages whose text is still stored, 30 days on and every 30 days after (Settings ›
	 * Languages). Asked only of people who manage languages; each opens the erase popup.
	 */
	private readonly remindersQuery = injectLanguageRemindersQuery(() =>
		this.authStore.permissions().includes('language.manage'),
	);
	readonly languageReminders = computed(() => this.remindersQuery.data()?.reminders ?? []);
	/** R4-7: Media storage at 85% of the plan or past it, for people who use Media. */
	private readonly storageQuery = injectMediaStorageQuery(() =>
		this.authStore.permissions().includes('attachment.index'),
	);
	readonly storageAlert = computed(() => {
		const summary = this.storageQuery.data();
		return summary && summary.percent >= 85 ? summary : null;
	});
	/** R5-5: pictures the website uses whose files the nightly check found gone. */
	private readonly nightlyQuery = injectNightlyCheckQuery(() =>
		this.authStore.permissions().includes('attachment.index'),
	);
	readonly missingPictures = computed(() => this.nightlyQuery.data()?.missingCount ?? 0);
	/** Purchases and stock: approvals waiting, decisions on my requests, late orders, old bills, held stock. */
	private readonly stockQuery = injectStockAlertsQuery(() =>
		STOCK_ALERT_PERMISSIONS.some((code) => this.authStore.permissions().includes(code)),
	);
	readonly stock = computed(() => stockBellLines(this.stockQuery.data()));
	/** Page Builder (SG-12, SG-18): drafts waiting for review (for those who may go live) and the nightly check. */
	private readonly pageBuilderQuery = injectPageBuilderAlertsQuery(() =>
		this.authStore.permissions().includes('theme_option.index'),
	);
	readonly pageReviews = computed(() => this.pageBuilderQuery.data()?.reviews ?? []);
	readonly pageChecks = computed(() => this.pageBuilderQuery.data()?.nightly?.layouts ?? []);
	readonly unreadNotificationCount = computed(
		() =>
			this.pageReviews().length +
			this.pageChecks().length +
			this.languageReminders().length +
			(this.storageAlert() ? 1 : 0) +
			(this.missingPictures() ? 1 : 0) +
			this.stock().length +
			this.notifications().filter((item) => !item.read_at).length,
	);

	private readonly router = inject(Router);
	private readonly stockGateway = inject(StockGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly transloco = inject(TranslocoService);

	/** The sentence for one stock line, in the reader's language. */
	stockText(line: StockBellLine): string {
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		const params = { ...line.params };
		if (line.quantity) params['qty'] = quantityText(line.quantity.units, line.quantity.soldBy, t);
		if (typeof params['date'] === 'string') params['date'] = shortDate(params['date']);
		return line.count === null
			? t(line.key, params)
			: this.transloco.translate(pluralKey(this.transloco, line.key, line.count), {
					...params,
					count: line.count,
				});
	}

	/** Opening a decision marks it seen, so the bell stops counting it. */
	async openStock(line: StockBellLine): Promise<void> {
		if (line.seenId) {
			await firstValueFrom(this.stockGateway.markSeen([line.seenId])).catch(() => undefined);
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.alerts });
		}
		await this.router.navigate(line.link, { queryParams: line.queryParams });
	}

	languageName(code: string): string {
		return languageName(code);
	}

	public active: boolean = false;

	clickHeaderOnMobile() {
		this.active = !this.active;
	}
}
