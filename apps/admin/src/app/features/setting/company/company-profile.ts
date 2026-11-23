import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	BUSINESS_KIND_LIST,
	companyProblems,
	kindEffects,
	partnerRemunerationLimitINR,
} from '@saha-textile/core-domain/company';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACCOUNTS_TEMPLATE_KEYS, AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BusinessKind, CompanyProfile, Director, Partner, Shareholder } from '@saha-textile/contracts';

const newId = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Settings › Company (accounts brief J1 and CT1–CT5; owner-approved 2026-11-23). Pick the kind of
 * business (public limited is not offered), then its numbers and its owners: the proprietor and any
 * other businesses under the same PAN, partners with capital, profit share, interest and pay, LLP
 * designated partners, or a company's directors, shareholders and capital (one-person company with
 * its nominee). The side says what the kind sets; problems show from the same rules the API uses.
 * The kind unlocks its accounts templates (AT1): "What opens" lists them, Save sets up the books from them, and once the
 * books exist the kind is changed only through Convert (AT-D3).
 */
@Component({
	selector: 'app-company-profile',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './company-profile.html',
})
export class CompanyProfileSettings {
	private readonly gateway = inject(CompanyGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);
	private readonly templates = inject(AccountsTemplatesGateway);

	readonly kinds = BUSINESS_KIND_LIST;
	readonly canEdit = computed(() => this.auth.permissions().includes('company.edit'));
	readonly query = injectQuery(() => ({
		queryKey: COMPANY_KEYS.profile,
		queryFn: () => firstValueFrom(this.gateway.profile()),
	}));
	readonly form = signal<CompanyProfile | null>(null);
	/** AT1: what the kind picked opens, and whether the books are set up already. */
	readonly opens = injectQuery(() => ({
		queryKey: ACCOUNTS_TEMPLATE_KEYS.opens(this.form()?.kind ?? 'proprietorship'),
		queryFn: () => firstValueFrom(this.templates.opens(this.form()?.kind ?? 'proprietorship')),
	}));
	readonly booksSetUp = computed(() => this.opens.data()?.booksSetUp ?? false);
	readonly saving = signal(false);
	readonly effects = computed(() => (this.form() ? kindEffects(this.form()!.kind) : null));
	readonly problems = computed(() => (this.form() ? companyProblems(this.form()!) : []));
	readonly shareTotal = computed(() =>
		(this.form()?.partners ?? []).reduce((sum, partner) => sum + partner.profitSharePercent, 0),
	);
	readonly totalShares = computed(() =>
		(this.form()?.shareholders ?? []).reduce((sum, holder) => sum + holder.shares, 0),
	);
	/** An example: the s.40(b) limit on ₹10 lakh of book profit, shown beside partner pay. */
	readonly remunerationExample = partnerRemunerationLimitINR(1_000_000);

	constructor() {
		effect(() => {
			const data = this.query.data();
			if (data) untracked(() => this.form.set(structuredClone(data)));
		});
	}

	set<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]): void {
		this.form.update((form) => (form ? { ...form, [key]: value } : form));
	}

	pickKind(kind: BusinessKind): void {
		if (this.canEdit() && !this.booksSetUp()) this.set('kind', kind);
	}

	setProprietor(change: Partial<NonNullable<CompanyProfile['proprietor']>>): void {
		const current = this.form()?.proprietor ?? { name: '', pan: '', openingCapitalINR: 0 };
		this.set('proprietor', { ...current, ...change } as CompanyProfile['proprietor']);
	}

	addPartner(): void {
		const partner: Partner = {
			id: newId('ptn'),
			name: '',
			pan: '',
			working: true,
			capitalINR: 0,
			profitSharePercent: 0,
			interestOnCapitalPercent: 0,
			monthlyRemunerationINR: 0,
			designated: false,
			dpin: null,
		};
		this.set('partners', [...(this.form()?.partners ?? []), partner]);
	}
	patchPartner(id: string, change: Partial<Partner>): void {
		this.set(
			'partners',
			(this.form()?.partners ?? []).map((partner) => (partner.id === id ? { ...partner, ...change } : partner)),
		);
	}
	removePartner(id: string): void {
		this.set(
			'partners',
			(this.form()?.partners ?? []).filter((partner) => partner.id !== id),
		);
	}

	addDirector(): void {
		const director: Director = {
			id: newId('dir'),
			name: '',
			din: '',
			since: new Date().toISOString().slice(0, 10),
			paidAs: 'none',
		};
		this.set('directors', [...(this.form()?.directors ?? []), director]);
	}
	patchDirector(id: string, change: Partial<Director>): void {
		this.set(
			'directors',
			(this.form()?.directors ?? []).map((director) =>
				director.id === id ? { ...director, ...change } : director,
			),
		);
	}
	removeDirector(id: string): void {
		this.set(
			'directors',
			(this.form()?.directors ?? []).filter((director) => director.id !== id),
		);
	}

	addShareholder(): void {
		const holder: Shareholder = { id: newId('shr'), name: '', shares: 1 };
		this.set('shareholders', [...(this.form()?.shareholders ?? []), holder]);
	}
	patchShareholder(id: string, change: Partial<Shareholder>): void {
		this.set(
			'shareholders',
			(this.form()?.shareholders ?? []).map((holder) => (holder.id === id ? { ...holder, ...change } : holder)),
		);
	}
	removeShareholder(id: string): void {
		this.set(
			'shareholders',
			(this.form()?.shareholders ?? []).filter((holder) => holder.id !== id),
		);
	}

	addOtherBusiness(): void {
		this.set('otherBusinesses', [
			...(this.form()?.otherBusinesses ?? []),
			{ tradeName: '', gstin: null, runsAs: 'own_deployment' },
		]);
	}
	patchOtherBusiness(index: number, change: Partial<CompanyProfile['otherBusinesses'][number]>): void {
		this.set(
			'otherBusinesses',
			(this.form()?.otherBusinesses ?? []).map((b, i) => (i === index ? { ...b, ...change } : b)),
		);
	}
	removeOtherBusiness(index: number): void {
		this.set(
			'otherBusinesses',
			(this.form()?.otherBusinesses ?? []).filter((_, i) => i !== index),
		);
	}

	/** A text field that stores null when emptied. */
	text(value: string): string | null {
		const trimmed = value.trim();
		return trimmed ? trimmed.toUpperCase() : null;
	}

	num(value: unknown): number {
		const n = Number(value);
		return Number.isFinite(n) && n >= 0 ? n : 0;
	}

	isCompany(kind: BusinessKind): boolean {
		return kind === 'private_limited' || kind === 'private_limited_opc';
	}

	isFirm(kind: BusinessKind): boolean {
		return kind === 'partnership' || kind === 'llp';
	}

	async save(): Promise<void> {
		const form = this.form();
		if (!form || !this.canEdit() || this.problems().length) return;
		this.saving.set(true);
		try {
			const { updatedAt, updatedBy, ...write } = form;
			void updatedBy;
			await firstValueFrom(this.gateway.saveProfile(write, this.query.data()?.updatedAt ?? updatedAt ?? null));
			await this.queryClient.invalidateQueries({ queryKey: COMPANY_KEYS.profile });
			// AT1: the first save sets up the books from the templates the kind unlocks.
			if (!this.booksSetUp() && this.auth.permissions().includes('accounts_template.edit')) {
				await firstValueFrom(this.templates.setUpBooks());
				await this.queryClient.invalidateQueries({ queryKey: ['accounts-templates'] });
			}
			this.notifier.showSuccess(this.transloco.translate('company_saved'));
		} catch {
			this.notifier.showError(this.transloco.translate('company_save_failed'));
		} finally {
			this.saving.set(false);
		}
	}
}
