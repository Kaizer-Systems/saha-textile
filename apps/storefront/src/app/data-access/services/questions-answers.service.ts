import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IQnAModel } from '@data-access/interfaces/questions-answers.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class QuestionsAnswersService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	getQuestionAnswers(slug: Params): Observable<IQnAModel> {
		const productSlug = String(slug['slug'] ?? slug['productSlug'] ?? '');
		return this.http
			.get<
				Array<{
					id: string;
					question: string;
					askerName: string | null;
					answer: string | null;
					answeredAt: string | null;
				}>
			>(`${environment.apiUrl}/catalog/questions`, { params: { productSlug } })
			.pipe(
				map((rows) => ({
					data: rows.map((row) => ({
						id: row.id,
						question: row.question,
						answer: row.answer ?? '',
						askerName: row.askerName,
						answeredAt: row.answeredAt,
					})),
					total: rows.length,
				})),
			);
	}

	ask(body: { productSlug: string; question: string; askerName: string; askerEmail: string; isAnonymous: boolean }) {
		return this.http.post(`${environment.apiUrl}/catalog/questions`, body, { withCredentials: true });
	}
}
