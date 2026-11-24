import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BankAccountKind, BankAccountWrite } from '@saha-textile/contracts';

const BANK_CODES = new Set([
	'bank_account_exists',
	'bank_account_changed',
	'bank_opening_needs_date',
	'bank_opening_is_posted',
	'books_need_a_location',
	'bank_layout_incomplete',
	'bank_layout_unknown',
	'match_rule_needs_words',
	'match_rule_then_wrong',
	'match_rule_unknown',
	'bank_line_already_matched',
	'bank_line_nothing_to_accept',
	'bank_line_nothing_to_reject',
	'bank_line_not_matched',
	'bank_line_not_found',
	'bank_link_entry_taken',
	'bank_link_entry_not_on_account',
]);

/** A refusal in the bank screens' words; anything else is the general failure. */
export function bankProblemKey(code: string): string {
	return BANK_CODES.has(code) ? `bank_problem_${code}` : 'bank_problem_failed';
}

export const BANK_KINDS: readonly BankAccountKind[] = [
	'current',
	'savings',
	'cash_credit',
	'overdraft',
	'fixed_deposit',
];

const blank = (): BankAccountWrite => ({
	kind: 'current',
	ifsc: '',
	bankName: '',
	branch: '',
	holder: '',
	number: '',
	shortName: '',
	limitINR: null,
	ratePercent: null,
	maturesOn: null,
	locationId: null,
	openingINR: 0,
	openingOn: null,
	chequeFrom: '',
	chequeTo: '',
	upiIds: [],
	active: true,
});

/**
 * Add or change a bank account (accounts brief BA2): the IFSC fills the bank from the app's own list; the kind decides
 * the group (a cash credit or overdraft with its limit, a fixed deposit with its rate and maturity); the opening
 * balance posts on its day when the account is added and is never changed here after.
 */
@Component({
	selector: 'app-bank-form',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './bank-form.html',
})
export class BankFormPage {
	private readonly gateway = inject(BanksGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly queries = inject(QueryClient);

	readonly kinds = BANK_KINDS;
	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), { initialValue: null });
	readonly locations = injectQuery(() => ({
		queryKey: ['locations', 'list'],
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly form = signal<BankAccountWrite>(blank());
	readonly version = signal(0);
	readonly upiText = signal('');
	readonly busy = signal(false);
	readonly problem = signal<string | null>(null);
	readonly credit = computed(() => this.form().kind === 'cash_credit' || this.form().kind === 'overdraft');
	readonly deposit = computed(() => this.form().kind === 'fixed_deposit');
	readonly ready = computed(() => {
		const f = this.form();
		return (
			/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc) &&
			f.bankName.trim().length >= 2 &&
			f.holder.trim().length >= 2 &&
			/^[0-9A-Z]{6,20}$/.test(f.number) &&
			f.shortName.trim().length >= 2 &&
			(!f.openingINR || !!f.openingOn) &&
			!this.busy()
		);
	});

	constructor() {
		const id = this.route.snapshot?.paramMap?.get('id');
		if (id) void this.load(id);
	}

	private async load(id: string): Promise<void> {
		const a = await firstValueFrom(this.gateway.one(id));
		this.form.set({
			kind: a.kind,
			ifsc: a.ifsc,
			bankName: a.bankName,
			branch: a.branch,
			holder: a.holder,
			number: a.number,
			shortName: a.shortName,
			limitINR: a.limitINR,
			ratePercent: a.ratePercent,
			maturesOn: a.maturesOn,
			locationId: a.locationId,
			openingINR: a.openingINR,
			openingOn: a.openingOn,
			chequeFrom: a.chequeFrom,
			chequeTo: a.chequeTo,
			upiIds: a.upiIds,
			active: a.active,
		});
		this.version.set(a.version);
		this.upiText.set(a.upiIds.join(', '));
	}

	set<K extends keyof BankAccountWrite>(key: K, value: BankAccountWrite[K]): void {
		this.form.update((f) => ({ ...f, [key]: value }));
	}

	/** The IFSC fills the bank, from the app's own list, when it knows it. */
	async ifsc(code: string): Promise<void> {
		const upper = code.trim().toUpperCase();
		this.set('ifsc', upper);
		if (upper.length !== 11) return;
		const found = await firstValueFrom(this.gateway.ifsc(upper)).catch(() => null);
		if (found?.bankName && !this.form().bankName) this.set('bankName', found.bankName);
	}

	async save(): Promise<void> {
		if (!this.ready()) return;
		const write = {
			...this.form(),
			upiIds: this.upiText()
				.split(',')
				.map((u) => u.trim())
				.filter((u) => u.length >= 3),
		};
		this.busy.set(true);
		this.problem.set(null);
		try {
			const id = this.id();
			const saved = await firstValueFrom(
				id ? this.gateway.edit(id, { ...write, version: this.version() }) : this.gateway.add(write),
			);
			await this.queries.invalidateQueries({ queryKey: BANK_KEYS.all });
			await this.router.navigate(['/accounts/banks', saved.id]);
		} catch (error) {
			this.problem.set(bankProblemKey(apiProblem(error, '')));
		} finally {
			this.busy.set(false);
		}
	}

	cancel(): void {
		const id = this.id();
		void this.router.navigate(id ? ['/accounts/banks', id] : ['/accounts/banks']);
	}
}
