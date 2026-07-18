import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IQnAModel } from '@data-access/interfaces/questions-answers.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class QuestionsAnswersService {
	private http = inject(HttpClient);

	getQuestionAnswers(payload?: Params): Observable<IQnAModel> {
		return this.http.get<IQnAModel>(`${environment.URL}/questions.json`, payload);
	}
}
