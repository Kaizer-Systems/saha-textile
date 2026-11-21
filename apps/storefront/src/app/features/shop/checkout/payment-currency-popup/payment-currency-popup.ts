import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { intlLocale } from '@saha-textile/core-domain/languages';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CheckoutGateway, type ShopCurrency } from '@core/checkout/checkout.gateway';
import { SettingStore } from '@core/state/setting.store';
import { toShopCurrency } from '@data-access/services/currency.service';
import { Button } from '@shared/ui/button/button';

import type { ICurrency } from '@data-access/interfaces/currency.interface';

/** Which popup the gateway's answer calls for (shipping brief shop04, shop05). */
export type CurrencyPopupKind = 'chooseCurrency' | 'switchToRegionCurrency';

/** The currencies the popups offer, the billing country's first (shop04, shop05, shop09). */
export const POPUP_CURRENCIES: ReadonlyArray<{ code: string; symbol: string; name: string }> = [
	{ code: 'INR', symbol: '₹', name: 'cur_inr' },
	{ code: 'GBP', symbol: '£', name: 'cur_gbp' },
	{ code: 'USD', symbol: 'US$', name: 'cur_usd' },
	{ code: 'EUR', symbol: '€', name: 'cur_eur' },
];

export function popupCurrencies(first: string | null, withRupees: boolean) {
	const list = POPUP_CURRENCIES.filter((row) => withRupees || row.code !== 'INR');
	const lead = list.find((row) => row.code === first);
	return lead ? [lead, ...list.filter((row) => row !== lead)] : list;
}

/** One row of the popup: a translation key for the four drawn currencies, the browser's own name for the rest. */
export interface PopupCurrencyRow {
	code: string;
	symbol: string;
	nameKey: string | null;
	name: string;
}

/**
 * The currency popup over the checkout (shipping brief shop04 "Please choose your currency" after PayPal
 * didn't complete, shop05 "Switch to your region's currency" when the INR gateway refused a card from
 * abroad; approved 19 Nov). Built from the shop's confirmation modal: `theme-modal`, `icon-box wo-bg`,
 * `modal-title`, `button-box` and `app-button`. The four drawn currencies come first, kept to the ones the
 * API prices in (`GET /currency`, the list the quote is checked against); "More currencies" adds the
 * API's other currencies. Continue sets the shop's currency, so the checkout quotes again in it; Close /
 * Try another card just closes.
 */
@Component({
	selector: 'app-payment-currency-popup',
	template: `
		<div class="modal-body">
			<i
				class="icon-box wo-bg"
				[class.ri-bank-card-line]="kind() === 'switchToRegionCurrency'"
				[class.ri-exchange-funds-line]="kind() !== 'switchToRegionCurrency'"
			></i>
			<h5
				class="modal-title"
				id="currency-popup-title"
			>
				{{ (kind() === 'switchToRegionCurrency' ? 'ret_switch_title' : 'ret_choose_title') | transloco }}
			</h5>
			<p>{{ (kind() === 'switchToRegionCurrency' ? 'ret_switch_text' : 'ret_choose_text') | transloco }}</p>
			<div class="mt-3 text-start">
				@for (row of rows(); track row.code) {
					<button
						type="button"
						class="btn btn-md d-flex justify-content-between align-items-center mb-2 w-100"
						[class.theme-bg-color]="choice() === row.code"
						[class.text-light]="choice() === row.code"
						[class.btn-theme-outline]="choice() !== row.code"
						[attr.aria-pressed]="choice() === row.code"
						(click)="picked.set(row.code)"
					>
						<span>
							<b>{{ row.symbol }}</b>
							{{ row.nameKey ? (row.nameKey | transloco) : row.name }}
						</span>
						@if (hint(row.code); as key) {
							<small>{{ key | transloco }}</small>
						}
					</button>
				}
				@if (!showAll() && more().length) {
					<a
						href="javascript:void(0)"
						class="small"
						(click)="showAll.set(true)"
					>
						{{ 'ret_more_currencies' | transloco }}
					</a>
				}
			</div>
			<div class="button-box">
				<app-button
					[class]="'btn btn-md fw-bold btn-theme-outline'"
					[spinner]="false"
					[id]="'currency_popup_close_btn'"
					(click)="modal.dismiss('close')"
				>
					{{ (kind() === 'switchToRegionCurrency' ? 'ret_try_another_card' : 'ret_close') | transloco }}
				</app-button>
				<app-button
					[class]="'btn theme-bg-color btn-md fw-bold text-light'"
					[spinner]="false"
					[id]="'currency_popup_continue_btn'"
					(click)="continueIn()"
				>
					{{ 'ret_continue_in' | transloco: { symbol: pickedSymbol() } }}
				</app-button>
			</div>
		</div>
	`,
	imports: [Button, TranslocoModule],
})
export class PaymentCurrencyPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly settings = inject(SettingStore);
	private readonly transloco = inject(TranslocoService);
	private readonly gateway = inject(CheckoutGateway);
	private readonly currencies = injectQuery(() => ({
		queryKey: ['shop-checkout', 'currencies'],
		queryFn: () => firstValueFrom(this.gateway.currencies()),
		staleTime: 5 * 60_000,
	}));

	/** Set by the checkout when it opens the popup. */
	readonly kind = signal<CurrencyPopupKind>('chooseCurrency');
	readonly first = signal<string | null>(null);

	readonly picked = signal<string | null>(null);
	readonly showAll = signal(false);

	/** The API's currencies; empty until they arrive, when the four drawn ones show as they are. */
	private readonly offered = computed<ShopCurrency[]>(() => this.currencies.data() ?? []);
	private readonly withRupees = computed(() => this.kind() !== 'switchToRegionCurrency');

	readonly drawn = computed<PopupCurrencyRow[]>(() => {
		const offered = this.offered();
		return popupCurrencies(this.first(), this.withRupees())
			.filter((row) => !offered.length || offered.some((currency) => currency.code === row.code))
			.map((row) => ({ code: row.code, symbol: row.symbol, nameKey: row.name, name: row.code }));
	});

	/** The API's other currencies, behind "More currencies". */
	readonly more = computed<PopupCurrencyRow[]>(() => {
		const known = new Set(POPUP_CURRENCIES.map((row) => row.code));
		return this.offered()
			.filter((currency) => !known.has(currency.code) && (this.withRupees() || currency.code !== 'INR'))
			.map((currency) => ({
				code: currency.code,
				symbol: currency.symbol,
				nameKey: null,
				name: this.displayName(currency.code),
			}));
	});

	readonly rows = computed(() => (this.showAll() ? [...this.drawn(), ...this.more()] : this.drawn()));

	/** The first row starts chosen. */
	readonly choice = computed(() => this.picked() ?? this.rows()[0]?.code ?? null);
	readonly pickedSymbol = computed(() => this.rows().find((row) => row.code === this.choice())?.symbol ?? '');

	/** shop04: ₹ "Card, UPI, net banking", others "PayPal"; shop05: only the billing currency is named. */
	hint(code: string): string | null {
		if (this.kind() === 'switchToRegionCurrency') return code === this.first() ? 'ret_from_billing' : null;
		return code === 'INR' ? 'ret_inr_ways' : 'ret_paypal';
	}

	/** "Continue in ₹/£": the shop's currency becomes the picked one, so the checkout quotes again in it. */
	continueIn(): void {
		const code = this.choice();
		const row = this.rows().find((item) => item.code === code);
		if (!code || !row) return;
		// The shop's own row, rate included, so prices across the shop follow the new currency.
		const index = this.offered().findIndex((currency) => currency.code === code);
		const offered = this.offered()[index];
		this.settings.setCurrency(
			offered
				? toShopCurrency(offered, index)
				: ({ ...(this.settings.selectedCurrency() ?? {}), code, symbol: row.symbol } as ICurrency),
		);
		this.modal.close(code);
	}

	private displayName(code: string): string {
		try {
			const names = new Intl.DisplayNames([intlLocale(this.transloco.getActiveLang())], { type: 'currency' });
			return names.of(code) ?? code;
		} catch {
			return code;
		}
	}
}
