import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACCOUNTS_TEMPLATE_KEYS, AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { RoleRow } from '@saha-textile/contracts';

/**
 * Settings › Accounts templates › Roles (accounts templates plan AT4): every role the engine posts to, the ledger or
 * group playing it in this company's books, and the template that set it. The list of roles is the engine's; a super
 * admin may point a ledger role at another ledger (the API refuses anyone else, and the page says so).
 */
@Component({
	selector: 'app-roles-page',
	imports: [PageWrapper, TranslocoModule, RouterLink],
	templateUrl: './roles-page.html',
})
export class RolesPage {
	private readonly gateway = inject(AccountsTemplatesGateway);
	private readonly ledgers = inject(LedgerGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly canEdit = computed(() => this.auth.permissions().includes('accounts_template.edit'));
	readonly roles = injectQuery(() => ({
		queryKey: ACCOUNTS_TEMPLATE_KEYS.roles,
		queryFn: () => firstValueFrom(this.gateway.roles()),
	}));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.ledgers.chart()),
	}));
	readonly choices = computed(() => (this.chart.data()?.ledgers ?? []).filter((l) => l.active));
	readonly problems = computed(() => (this.roles.data() ?? []).filter((row) => row.problem).length);
	readonly busy = signal(false);

	usedBy(row: RoleRow): string {
		return row.usedBy.map((type) => this.transloco.translate(`ar_doc_${type}`)).join(', ');
	}

	async point(row: RoleRow, ledgerId: string): Promise<void> {
		if (!ledgerId || ledgerId === row.holderId) return;
		this.busy.set(true);
		try {
			const rows = await firstValueFrom(this.gateway.pointRole(row.key, ledgerId));
			this.queryClient.setQueryData(ACCOUNTS_TEMPLATE_KEYS.roles, rows);
			await this.queryClient.invalidateQueries({ queryKey: ['accounts'] });
			this.notifier.showSuccess(this.transloco.translate('ar_pointed'));
		} catch (error) {
			const code = apiProblem(error, '');
			const known = ['roles_super_admin_only', 'ledger_changed', 'role_ledger_unknown'];
			this.notifier.showError(
				this.transloco.translate(known.includes(code) ? `ar_problem_${code}` : 'at_action_failed'),
			);
			await this.queryClient.invalidateQueries({ queryKey: ACCOUNTS_TEMPLATE_KEYS.roles });
		} finally {
			this.busy.set(false);
		}
	}
}
