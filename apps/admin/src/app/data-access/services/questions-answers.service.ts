import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IQnAModel } from '@data-access/interfaces/questions-answers.interface';

@Injectable({
	providedIn: 'root',
})
export class QuestionsAnswersService {
	private http = inject(HttpClient);

	getQuestionAnswers(payload?: Params): Observable<IQnAModel> {
		return this.http.get<IQnAModel>(`${environment.URL}/questions.json`, payload);
	}
}
