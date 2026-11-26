import { inject } from '@angular/core';

import { injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { IAdminQuestionListParams } from '@data-access/interfaces/questions-answers.interface';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

export const ADMIN_QUESTIONS_KEY = 'admin-questions';

export function injectQuestionAnswersQuery(params: () => IAdminQuestionListParams) {
	const service = inject(QuestionsAnswersService);
	return injectQuery(() => ({
		queryKey: [ADMIN_QUESTIONS_KEY, params()],
		queryFn: () => firstValueFrom(service.list(params())),
		placeholderData: keepPreviousData,
	}));
}
