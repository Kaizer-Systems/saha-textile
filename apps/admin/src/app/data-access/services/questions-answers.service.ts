import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { IAdminQuestionListParams, IAdminQuestionPage } from '@data-access/interfaces/questions-answers.interface';

import { environment } from '../../../../public/environments/environment';

/** Product questions for moderation: list, answer, reject, delete. */
@Injectable({
	providedIn: 'root',
})
export class QuestionsAnswersService {
	private http = inject(HttpClient);

	list(params: IAdminQuestionListParams): Observable<IAdminQuestionPage> {
		const query: Record<string, string | number> = {};
		for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query[key] = value;
		return this.http.get<IAdminQuestionPage>(`${environment.apiUrl}/admin/catalog/questions`, {
			params: query,
			withCredentials: true,
		});
	}

	answer(questionId: string, answer: string) {
		return this.http.post(
			`${environment.apiUrl}/admin/catalog/questions/${encodeURIComponent(questionId)}/answer`,
			{ answer },
			{ withCredentials: true },
		);
	}

	reject(questionId: string) {
		return this.http.post(
			`${environment.apiUrl}/admin/catalog/questions/${encodeURIComponent(questionId)}/reject`,
			{},
			{ withCredentials: true },
		);
	}

	remove(questionId: string) {
		return this.http.delete(`${environment.apiUrl}/admin/catalog/questions/${encodeURIComponent(questionId)}`, {
			withCredentials: true,
		});
	}
}
