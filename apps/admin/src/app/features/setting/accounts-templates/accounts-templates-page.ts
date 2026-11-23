import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { BUSINESS_KIND_LIST } from '@saha-textile/core-domain/company';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACCOUNTS_TEMPLATE_KEYS, AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BusinessKind, TemplateKind, TemplateLibraryRow } from '@saha-textile/contracts';

/**
 * Settings › Accounts templates (accounts templates AT2): every chart, tax rule set and report template with its
 * reference code, the kinds it applies to, its newest version and whether it is installed. Another kind's templates
 * stay listed, greyed, with the reason (AT-D2), so the CA can see what that kind would get. Making and importing
 * templates come with the builder (T4, T7).
 */
@Component({
	selector: 'app-accounts-templates-page',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './accounts-templates-page.html',
})
export class AccountsTemplatesPage {
	private readonly gateway = inject(AccountsTemplatesGateway);
	private readonly company = inject(CompanyGateway);
	private readonly transloco = inject(TranslocoService);

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

	/** Installed (with an update waiting), not installed, or locked for another kind. */
	state(row: TemplateLibraryRow): { key: string; version: number } {
		if (row.locked) return { key: 'at_state_locked', version: row.latestVersion };
		if (row.installedVersion === null) return { key: 'at_state_not_installed', version: row.latestVersion };
		return { key: row.updateAvailable ? 'at_state_update' : 'at_state_installed', version: row.latestVersion };
	}

	day(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}
}
