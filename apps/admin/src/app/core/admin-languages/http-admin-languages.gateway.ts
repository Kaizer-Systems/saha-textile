import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import {
	AdminLanguagesGateway,
	type LanguageReminderResponse,
	type LanguageSettingsResponse,
	type LanguageTodoResponse,
} from './admin-languages.gateway';

/** Changes are quiet: the page names each refusal itself. */
const quiet = () => ({ context: new HttpContext().set(QUIET_ERRORS, true) });

@Injectable({ providedIn: 'root' })
export class HttpAdminLanguagesGateway extends AdminLanguagesGateway {
	private readonly http = inject(HttpClient);
	/** Read per call: the runtime config loads after the app starts. */
	private url(path = ''): string {
		return `${runtimeConfig.apiUrl}/admin/languages${path}`;
	}

	override settings(): Observable<LanguageSettingsResponse> {
		return this.http.get<LanguageSettingsResponse>(this.url('/settings'));
	}

	override todo(code: string): Observable<LanguageTodoResponse> {
		return this.http.get<LanguageTodoResponse>(this.url(`/${encodeURIComponent(code)}/todo`));
	}

	override reminders(): Observable<LanguageReminderResponse> {
		return this.http.get<LanguageReminderResponse>(this.url('/reminders'), quiet());
	}

	override add(code: string): Observable<LanguageSettingsResponse> {
		return this.http.post<LanguageSettingsResponse>(this.url(), { code }, quiet());
	}

	override switchAdmin(code: string, on: boolean): Observable<LanguageSettingsResponse> {
		return this.http.put<LanguageSettingsResponse>(this.url(`/${encodeURIComponent(code)}/admin`), { on }, quiet());
	}

	override switchShop(code: string, on: boolean): Observable<LanguageSettingsResponse> {
		return this.http.put<LanguageSettingsResponse>(this.url(`/${encodeURIComponent(code)}/shop`), { on }, quiet());
	}

	override remove(code: string): Observable<LanguageSettingsResponse> {
		return this.http.delete<LanguageSettingsResponse>(this.url(`/${encodeURIComponent(code)}`), quiet());
	}

	override keep(code: string): Observable<LanguageSettingsResponse> {
		return this.http.post<LanguageSettingsResponse>(this.url(`/${encodeURIComponent(code)}/keep`), {}, quiet());
	}

	override erase(code: string, confirm: string): Observable<LanguageSettingsResponse> {
		return this.http.post<LanguageSettingsResponse>(
			this.url(`/${encodeURIComponent(code)}/erase`),
			{ confirm },
			quiet(),
		);
	}

	override missing(area: string, code: string): Observable<{ ids: string[] }> {
		return this.http.get<{ ids: string[] }>(
			this.url(`/${encodeURIComponent(code)}/missing/${encodeURIComponent(area)}`),
		);
	}
}
