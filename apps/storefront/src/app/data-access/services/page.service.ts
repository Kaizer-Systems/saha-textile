import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { IFaqModel } from '@data-access/interfaces/page.interface';
import { IStaticPage } from '@data-access/interfaces/static-page.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class PageService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	/** The shop-wide FAQ in the page language (English where a translation is missing). */
	getFaqs(locale = 'en'): Observable<IFaqModel> {
		const pick = (text: Record<string, string | undefined>) => text[locale] || text['en'] || '';
		return this.http
			.get<Array<{ id: string; question: Record<string, string>; answer: Record<string, string> }>>(
				`${environment.apiUrl}/catalog/faq`,
			)
			.pipe(
				map((rows) => ({
					data: rows.map((row, index) => ({
						id: index + 1,
						title: pick(row.question),
						description: pick(row.answer),
						created_by_id: '',
						status: 'live',
					})),
					total: rows.length,
				})),
			);
	}

	// The legal pages (privacy policy, terms, refunds and returns, shipping) from the API, written in Admin › Pages.
	/** A legal page in one language from the API (Legal Pages brief); the API falls back to English. */
	getPage(slug: string, locale = 'en'): Observable<IStaticPage> {
		return this.http.get<IStaticPage>(`${runtimeConfig.apiUrl}/catalog/pages/${encodeURIComponent(slug)}`, {
			params: { locale },
		});
	}
}
