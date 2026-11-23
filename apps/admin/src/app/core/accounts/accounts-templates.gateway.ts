import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import { QUIET } from '../purchasing/purchasing.gateway';

import type {
	AccountsTemplate,
	BusinessKind,
	RoleRow,
	TemplateChanges,
	TemplateDraftWrite,
	TemplateLibraryRow,
	TemplateNew,
	TemplatesOpen,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const ACCOUNTS_TEMPLATE_KEYS = {
	library: ['accounts-templates', 'library'] as const,
	one: (code: string) => ['accounts-templates', code] as const,
	opens: (kind: BusinessKind) => ['accounts-templates', 'opens', kind] as const,
	changes: (code: string) => ['accounts-templates', code, 'changes'] as const,
	roles: ['accounts-templates', 'roles'] as const,
};

/** Accounts templates (owner-approved 2026-11-24, T2–T3): the library, what a kind opens, setting up the books. */
@Injectable({ providedIn: 'root' })
export class AccountsTemplatesGateway {
	private readonly http = inject(HttpClient);
	private readonly base = () => `${runtimeConfig.apiUrl}/admin/accounts/templates`;

	library(): Observable<TemplateLibraryRow[]> {
		return this.http.get<TemplateLibraryRow[]>(this.base());
	}
	get(code: string): Observable<AccountsTemplate> {
		return this.http.get<AccountsTemplate>(`${this.base()}/${encodeURIComponent(code)}`);
	}
	opens(kind: BusinessKind): Observable<TemplatesOpen> {
		return this.http.get<TemplatesOpen>(`${this.base()}/opens`, { params: { kind } });
	}
	/** AT1 "Save and set up the books". */
	setUpBooks(): Observable<TemplateLibraryRow[]> {
		return this.http.post<TemplateLibraryRow[]>(`${this.base()}/set-up-books`, {});
	}
	/** AT2 New template, Import; AT3 Save draft, Changes, Publish. Quiet: each screen says why in place. */
	create(write: TemplateNew): Observable<AccountsTemplate> {
		return this.http.post<AccountsTemplate>(this.base(), write, QUIET);
	}
	importTemplate(template: unknown): Observable<AccountsTemplate> {
		return this.http.post<AccountsTemplate>(`${this.base()}/import`, template, QUIET);
	}
	saveDraft(code: string, write: TemplateDraftWrite): Observable<AccountsTemplate> {
		return this.http.put<AccountsTemplate>(`${this.base()}/${encodeURIComponent(code)}/draft`, write, QUIET);
	}
	changes(code: string): Observable<TemplateChanges | null> {
		return this.http.get<TemplateChanges | null>(`${this.base()}/${encodeURIComponent(code)}/changes`);
	}
	publish(code: string, expectedUpdatedAt: string): Observable<AccountsTemplate> {
		return this.http.post<AccountsTemplate>(
			`${this.base()}/${encodeURIComponent(code)}/publish`,
			{ expectedUpdatedAt },
			QUIET,
		);
	}
	/** AT4 roles in this company's books, and pointing one at another ledger (super admin). */
	roles(): Observable<RoleRow[]> {
		return this.http.get<RoleRow[]>(`${runtimeConfig.apiUrl}/admin/accounts/roles`);
	}
	pointRole(key: string, ledgerId: string): Observable<RoleRow[]> {
		return this.http.put<RoleRow[]>(
			`${runtimeConfig.apiUrl}/admin/accounts/roles/${encodeURIComponent(key)}`,
			{ ledgerId },
			QUIET,
		);
	}
}
