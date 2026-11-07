import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { FaqScope, IFaqModel } from '@data-access/interfaces/faq.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class FaqService {
	private http = inject(HttpClient);

	getFaqs(payload?: Params): Observable<IFaqModel> {
		return this.http
			.get<{
				items: Array<{
					id: string;
					question: { en: string; fr?: string };
					answer: { en: string; fr?: string };
					status: string;
					scope: FaqScope;
					categoryIds: string[];
					productIds: string[];
				}>;
				total: number;
			}>(`${environment.apiUrl}/admin/catalog/faq`, { params: payload, withCredentials: true })
			.pipe(
				map((page) => ({
					data: page.items.map((row, index) => ({
						id: index + 1,
						faqId: row.id,
						title: row.question.en,
						description: row.answer.en,
						titleFr: row.question.fr ?? '',
						descriptionFr: row.answer.fr ?? '',
						created_by_id: false,
						status: row.status === 'live',
						scope: row.scope,
						categoryIds: row.categoryIds,
						productIds: row.productIds,
					})),
					total: page.total,
				})),
			);
	}

	save(row: {
		faqId?: string;
		title: string;
		description: string;
		titleFr?: string;
		descriptionFr?: string;
		status: boolean;
		scope?: FaqScope;
		categoryIds?: string[];
		productIds?: string[];
	}) {
		return this.http.post(
			`${environment.apiUrl}/admin/catalog/faq`,
			{
				id: row.faqId,
				question: { en: row.title, fr: row.titleFr || undefined },
				answer: { en: row.description, fr: row.descriptionFr || undefined },
				scope: row.scope ?? 'global',
				categoryIds: row.categoryIds ?? [],
				productIds: row.productIds ?? [],
				status: row.status ? 'live' : 'draft',
			},
			{ withCredentials: true },
		);
	}

	remove(faqId: string | undefined) {
		return this.http.delete(`${environment.apiUrl}/admin/catalog/faq/${encodeURIComponent(faqId ?? '')}`, {
			withCredentials: true,
		});
	}
}
