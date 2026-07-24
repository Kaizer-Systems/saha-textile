import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

export function injectQuestionAnswersQuery(params: () => Params) {
	const questionsAnswersService = inject(QuestionsAnswersService);
	return injectQuery(() => ({
		queryKey: ['question-answers', params()],
		queryFn: () => firstValueFrom(questionsAnswersService.getQuestionAnswers(params())),
	}));
}
