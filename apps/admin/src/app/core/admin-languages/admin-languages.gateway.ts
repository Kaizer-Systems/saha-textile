import type { LanguageReminderResponse, LanguageSettingsResponse, LanguageTodoResponse } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type { LanguageReminderResponse, LanguageSettingsResponse, LanguageTodoResponse };

/**
 * Settings › Languages (step 0d): every language with its switches, a language's to-do list, and
 * the changes. Each change answers the whole page as stored after it.
 */
export abstract class AdminLanguagesGateway {
	abstract settings(): Observable<LanguageSettingsResponse>;
	abstract todo(code: string): Observable<LanguageTodoResponse>;
	abstract reminders(): Observable<LanguageReminderResponse>;
	abstract add(code: string): Observable<LanguageSettingsResponse>;
	abstract switchAdmin(code: string, on: boolean): Observable<LanguageSettingsResponse>;
	abstract switchShop(code: string, on: boolean): Observable<LanguageSettingsResponse>;
	abstract remove(code: string): Observable<LanguageSettingsResponse>;
	abstract keep(code: string): Observable<LanguageSettingsResponse>;
	abstract erase(code: string, confirm: string): Observable<LanguageSettingsResponse>;
	/** The ids of the items one list shows for "missing in this language". */
	abstract missing(area: string, code: string): Observable<{ ids: string[] }>;
}
