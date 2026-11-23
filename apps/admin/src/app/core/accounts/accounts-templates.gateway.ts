import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type { AccountsTemplate, BusinessKind, TemplateLibraryRow, TemplatesOpen } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const ACCOUNTS_TEMPLATE_KEYS = {
	library: ['accounts-templates', 'library'] as const,
	one: (code: string) => ['accounts-templates', code] as const,
	opens: (kind: BusinessKind) => ['accounts-templates', 'opens', kind] as const,
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
}
