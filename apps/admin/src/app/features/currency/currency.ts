import { Component, computed, effect, inject, signal, type TemplateRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { currencyDisplayName, FETCH_TIME_PATTERN, FX_KEY, FxGateway, injectFxOverviewQuery } from '@core/fx/fx.gateway';
import { shippingProblemKey } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { AdminCurrencyRow, AdminFxOverview, FxRateSource, FxSettings } from '@saha-textile/contracts';

/** The settings as edited on the page, saved together. */
interface FxDraft {
	source: FxRateSource;
	markup: number;
	fetchEnabled: boolean;
	fetchTime: string;
}

/**
 * Admin › Currencies (shipping rules brief fx01–fx03): one rate source at a time (PayPal's own
 * rates once PayPal approves the account, or the stored rates), the PayPal markup (one number for
 * every currency; only a super admin changes it), the daily fetch, and each currency's stored rate
 * as rupees per unit with what a ₹10,000 piece costs in it.
 */
@Component({
	selector: 'app-currency',
	templateUrl: './currency.html',
	styleUrls: ['./currency.scss'],
	imports: [PageWrapper, FormFields, FormsModule, RouterModule, TranslocoModule],
})
export class Currency {
	private readonly gateway = inject(FxGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);
	private readonly modals = inject(NgbModal);

	readonly query = injectFxOverviewQuery();
	readonly canEdit = computed(() => this.auth.permissions().includes('currency.edit'));
	readonly draft = signal<FxDraft | null>(null);
	readonly saving = signal(false);
	readonly fetching = signal(false);
	/** The theme-coloured border of the chosen source, as drawn in the brief. */
	readonly chosenBorder = '2px solid var(--theme-color)';

	private readonly ratePopup = viewChild<TemplateRef<unknown>>('ratePopup');
	private openPopup: NgbModalRef | null = null;
	private saveAgain = false;
	readonly editing = signal<{ row: AdminCurrencyRow; inrPerUnit: number | null; enabled: boolean } | null>(null);

	constructor() {
		// The page follows the server's settings, except while a save is on its way (the change
		// being saved stays on screen).
		effect(() => {
			const tracked = this.query.data();
			const data = this.queryClient.getQueryData<AdminFxOverview>([...FX_KEY]) ?? tracked;
			if (data && !this.saving()) this.draft.set(this.draftOf(data.settings));
		});
	}

	private draftOf(settings: FxSettings): FxDraft {
		return {
			source: settings.source,
			markup: settings.paypalMarkupPercent,
			fetchEnabled: settings.dailyFetch.enabled,
			fetchTime: settings.dailyFetch.time,
		};
	}

	/**
	 * The brief draws no Save button on this page (fx01): each change saves as it is made, one save
	 * at a time; a change made during a save is sent right after it with the new revision.
	 */
	patch(change: Partial<FxDraft>) {
		this.draft.update((draft) => (draft ? { ...draft, ...change } : draft));
		void this.save();
	}

	/** "US Dollar", "Pound Sterling": the currency's name in the admin's language. */
	currencyName(code: string): string {
		return currencyDisplayName(code, this.transloco.getActiveLang(), (key) => this.transloco.translate(key));
	}

	/** The fetch time box takes "12:30" (24-hour, India time); anything else is refused and put back. */
	setFetchTime(value: string) {
		const time = value.trim();
		if (FETCH_TIME_PATTERN.test(time)) {
			this.patch({ fetchTime: time });
			return;
		}
		const data = this.query.data();
		if (data) this.draft.set(this.draftOf(data.settings));
		this.notifier.showError(this.transloco.translate('fx_err_time'));
	}

	/** "19 Nov, 12:30", India time. */
	when(value: string | null): string {
		if (!value) return '—';
		const date = new Date(value);
		const day = date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
		const time = date.toLocaleTimeString('en-IN', {
			timeZone: 'Asia/Kolkata',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		return `${day}, ${time}`;
	}

	setBy(row: AdminCurrencyRow): string {
		if (row.setBy === 'fetch') return this.transloco.translate('fx_set_by_fetch');
		if (row.setBy === 'staff')
			return this.transloco.translate('fx_set_by_staff', { name: row.setByName?.split(/\s+/)[0] ?? '' });
		return '—';
	}

	/** "88.42": two decimals, as the brief writes rates; the rate popup shows the stored figure. */
	rate(value: number | null): string {
		return value === null
			? '—'
			: value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	example(row: AdminCurrencyRow, exampleINR: number): string {
		if (row.examplePrice === null) return '—';
		const price = row.examplePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return `₹${exampleINR.toLocaleString('en-IN')} → ${row.symbol}${price}`;
	}

	/** fx03: PayPal's rates failing while they are the chosen source; the stored rates step in. */
	readonly paypalDown = computed(() => {
		const settings = this.query.data()?.settings;
		return settings?.source === 'paypalFxaas' ? settings.paypalFxaas.unavailableSince : null;
	});

	async save() {
		// The cache, not the signal: it holds the revision a save just returned, at once.
		const data = this.queryClient.getQueryData<AdminFxOverview>([...FX_KEY]) ?? this.query.data();
		const draft = this.draft();
		if (!data || !draft) return;
		if (this.saving()) {
			this.saveAgain = true;
			return;
		}
		const unchanged =
			draft.source === data.settings.source &&
			Number(draft.markup) === data.settings.paypalMarkupPercent &&
			draft.fetchEnabled === data.settings.dailyFetch.enabled &&
			draft.fetchTime === data.settings.dailyFetch.time;
		if (unchanged) return;
		this.saving.set(true);
		try {
			const saved = await firstValueFrom(
				this.gateway.saveSettings({
					source: draft.source,
					paypalMarkupPercent: Number(draft.markup),
					dailyFetch: { enabled: draft.fetchEnabled, time: draft.fetchTime },
					revision: data.settings.revision,
				}),
			);
			this.queryClient.setQueryData([...FX_KEY], saved);
			this.notifier.showSuccess(this.transloco.translate('fx_saved'));
		} catch (error) {
			this.saveAgain = false;
			this.draft.set(this.draftOf(data.settings));
			this.notifier.showError(this.transloco.translate(fxProblemKey(error)));
		} finally {
			this.saving.set(false);
		}
		if (this.saveAgain) {
			this.saveAgain = false;
			await this.save();
		}
	}

	async fetchNow() {
		if (this.fetching()) return;
		this.fetching.set(true);
		try {
			const result = await firstValueFrom(this.gateway.fetchNow());
			await this.queryClient.invalidateQueries({ queryKey: [...FX_KEY] });
			if (result.ok)
				this.notifier.showSuccess(this.transloco.translate('fx_fetched', { count: result.updated.length }));
			else
				this.notifier.showError(this.transloco.translate('fx_fetch_failed', { problem: result.problem ?? '' }));
		} catch (error) {
			this.notifier.showError(this.transloco.translate(fxProblemKey(error)));
		} finally {
			this.fetching.set(false);
		}
	}

	edit(row: AdminCurrencyRow) {
		this.editing.set({ row, inrPerUnit: row.inrPerUnit, enabled: row.stored ? row.enabled : true });
		const popup = this.ratePopup();
		if (popup)
			this.openPopup = this.modals.open(popup, {
				centered: true,
				windowClass: 'theme-modal',
				ariaLabelledBy: 'fx_rate_title',
			});
	}

	patchEditing(change: Partial<{ inrPerUnit: number | null; enabled: boolean }>) {
		this.editing.update((current) => (current ? { ...current, ...change } : current));
	}

	async saveRate() {
		const current = this.editing();
		if (!current || this.saving()) return;
		const typed = Number(current.inrPerUnit);
		const changedRate = current.inrPerUnit !== null && typed > 0 && typed !== current.row.inrPerUnit;
		this.saving.set(true);
		try {
			const saved = await firstValueFrom(
				this.gateway.setRate(current.row.code, {
					...(changedRate ? { inrPerUnit: typed } : {}),
					enabled: current.enabled,
				}),
			);
			this.queryClient.setQueryData([...FX_KEY], saved);
			this.openPopup?.close();
			this.notifier.showSuccess(this.transloco.translate('fx_rate_saved', { code: current.row.code }));
		} catch (error) {
			this.notifier.showError(this.transloco.translate(fxProblemKey(error)));
		} finally {
			this.saving.set(false);
		}
	}
}

/** The server's refusal as words: `fx_err_<code>`, else the shipping pages' general line. */
export function fxProblemKey(error: unknown): string {
	const outer = (error as { error?: unknown } | null)?.error;
	const body = (outer && typeof outer === 'object' ? outer : {}) as {
		code?: unknown;
		issues?: Array<{ code?: unknown }>;
	};
	const code = typeof body.code === 'string' ? body.code : body.issues?.[0]?.code;
	const known = ['stale_revision', 'super_admin_only', 'fxaas_not_approved', 'rate_required', 'home_currency'];
	return typeof code === 'string' && known.includes(code) ? `fx_err_${code}` : shippingProblemKey(error);
}
