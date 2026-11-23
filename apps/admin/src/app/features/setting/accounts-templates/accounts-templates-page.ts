import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { BUSINESS_KIND_LIST } from '@saha-textile/core-domain/company';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACCOUNTS_TEMPLATE_KEYS, AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BusinessKind, TemplateKind, TemplateLibraryRow, TemplateNew } from '@saha-textile/contracts';

/** A template's words: a code the builder refuses with, else the failure. */
export function templateWords(code: string, translate: (key: string) => string): string {
	return /^(template_|duplicate_template_code)/.test(code)
		? translate(`at_problem_${code.split(':')[0]}`)
		: translate('at_action_failed');
}

const blank = (): TemplateNew => ({
	code: '',
	kind: 'chart',
	name: '',
	description: '',
	appliesTo: { all: true, kinds: [] },
	startFrom: null,
});

/**
 * Settings › Accounts templates (accounts templates AT2): every chart, tax rule set and report template with its
 * reference code, the kinds it applies to, its newest version and whether it is installed. Another kind's templates
 * stay listed, greyed, with the reason (AT-D2), so the CA can see what that kind would get. Making and importing
 * templates come with the builder (T4, T7).
 */
@Component({
	selector: 'app-accounts-templates-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './accounts-templates-page.html',
})
export class AccountsTemplatesPage {
	private readonly gateway = inject(AccountsTemplatesGateway);
	private readonly company = inject(CompanyGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly queryClient = inject(QueryClient);
	private readonly router = inject(Router);
	private readonly auth = inject(AuthStore);

	readonly canEdit = computed(() => this.auth.permissions().includes('accounts_template.edit'));
	readonly kinds = BUSINESS_KIND_LIST;
	readonly types: readonly TemplateKind[] = ['chart', 'taxRules', 'report'];
	readonly kind = signal<BusinessKind | ''>('');
	readonly type = signal<TemplateKind | ''>('');

	readonly library = injectQuery(() => ({
		queryKey: ACCOUNTS_TEMPLATE_KEYS.library,
		queryFn: () => firstValueFrom(this.gateway.library()),
	}));
	readonly profile = injectQuery(() => ({
		queryKey: COMPANY_KEYS.profile,
		queryFn: () => firstValueFrom(this.company.profile()),
	}));

	/** The rows for the chosen kind (templates shared or exclusive to it) and type. */
	readonly rows = computed(() =>
		(this.library.data() ?? []).filter(
			(row) =>
				(!this.kind() || row.appliesTo.all || row.appliesTo.kinds.includes(this.kind() as BusinessKind)) &&
				(!this.type() || row.kind === this.type()),
		),
	);

	appliesTo(row: TemplateLibraryRow): string {
		if (row.appliesTo.all) return this.transloco.translate('at_all_kinds');
		return row.appliesTo.kinds.map((kind) => this.transloco.translate(`co_kind_${kind}`)).join(', ');
	}

	/** A draft only, installed (with an update waiting), not installed, or locked for another kind. */
	state(row: TemplateLibraryRow): { key: string; version: number } {
		if (row.latestVersion === null) return { key: 'at_state_draft', version: 0 };
		if (row.locked) return { key: 'at_state_locked', version: row.latestVersion };
		if (row.installedVersion === null) return { key: 'at_state_not_installed', version: row.latestVersion };
		return { key: row.updateAvailable ? 'at_state_update' : 'at_state_installed', version: row.latestVersion };
	}

	/* ------------------------------------------------------------ AT2 New template and Import */

	readonly fresh = signal<TemplateNew>(blank());
	readonly creating = signal(false);
	private modal: NgbModalRef | null = null;
	/** What a new template may start from: a template of the same type with a version. */
	readonly startOptions = computed(() =>
		(this.library.data() ?? []).filter((row) => row.kind === this.fresh().kind && row.latestVersion !== null),
	);
	readonly canCreate = computed(() => {
		const fresh = this.fresh();
		return (
			/^[A-Z]{2}-[A-Z0-9-]{2,30}$/.test(fresh.code) &&
			fresh.name.trim().length > 0 &&
			(fresh.appliesTo.all || fresh.appliesTo.kinds.length > 0) &&
			!this.creating()
		);
	});

	openNew(template: TemplateRef<unknown>): void {
		this.fresh.set(blank());
		this.modal = this.modals.open(template, { centered: true });
	}

	patchNew(change: Partial<TemplateNew>): void {
		this.fresh.update((fresh) => ({ ...fresh, ...change }));
	}

	toggleKind(kind: BusinessKind, on: boolean): void {
		const kinds = this.fresh().appliesTo.kinds.filter((k) => k !== kind);
		this.patchNew({ appliesTo: { all: false, kinds: on ? [...kinds, kind] : kinds } });
	}

	private words(error: unknown): string {
		return templateWords(apiProblem(error, ''), (key) => this.transloco.translate(key));
	}

	async create(): Promise<void> {
		if (!this.canCreate()) return;
		this.creating.set(true);
		try {
			const made = await firstValueFrom(this.gateway.create(this.fresh()));
			await this.queryClient.invalidateQueries({ queryKey: ['accounts-templates'] });
			this.modal?.close();
			await this.router.navigate(['/setting/accounts-templates', made.code]);
		} catch (error) {
			this.notifier.showError(this.words(error));
		} finally {
			this.creating.set(false);
		}
	}

	/** AT2 Import: a template file saved from another deployment. */
	async importFile(input: { files: ArrayLike<{ text(): Promise<string> }> | null; value: string }): Promise<void> {
		const file = input.files?.[0];
		if (!file) return;
		try {
			const made = await firstValueFrom(this.gateway.importTemplate(JSON.parse(await file.text()) as unknown));
			await this.queryClient.invalidateQueries({ queryKey: ['accounts-templates'] });
			this.notifier.showSuccess(this.transloco.translate('at_imported', { code: made.code }));
		} catch (error) {
			this.notifier.showError(
				error instanceof SyntaxError ? this.transloco.translate('at_import_not_json') : this.words(error),
			);
		} finally {
			input.value = '';
		}
	}

	day(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}
}
