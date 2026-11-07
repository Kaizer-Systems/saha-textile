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

	getQuestionAnswers(payload?: Params): Observable<IQnAModel> {
		return this.http
			.get<{
				items: Array<{
					id: string;
					question: string;
					answer: string | null;
					productId: string;
					createdAt?: string;
				}>;
				total: number;
			}>(`${environment.apiUrl}/admin/catalog/questions`, { params: payload, withCredentials: true })
			.pipe(
				map((page) => ({
					data: page.items.map((row, index) => ({
						id: index + 1,
						questionId: row.id,
						answer: row.answer ?? '',
						product_id: 0,
						product: { id: 0, name: row.productId },
						store: { id: 0, store_name: '' },
						reaction: null,
						question: row.question,
						total_dislikes: 0,
						total_likes: 0,
						consumer_id: 0,
						created_at: row.createdAt,
					})),
					total: page.total,
				})),
			);
	}

	answer(questionId: string, answer: string) {
		return this.http.post(
			`${environment.apiUrl}/admin/catalog/questions/${encodeURIComponent(questionId)}/answer`,
			{ answer },
			{ withCredentials: true },
		);
	}
}
