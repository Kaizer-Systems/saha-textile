import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

/**
 * TanStack Query for a product's Q&A (replaces NGXS QuestionAnswersState +
 * GetQuestionAnswersAction). Keyed on product id. The old FeedbackAction (local
 * like/dislike mutation) is now an optimistic queryClient.setQueryData on
 * ['qna', productId] from the display widget. Send/Update were no-op mocks.
 */
export function injectQuestionAnswersQuery(productId: () => number | string | undefined) {
	const service = inject(QuestionsAnswersService);
	return injectQuery(() => ({
		queryKey: ['qna', productId()],
		queryFn: () => firstValueFrom(service.getQuestionAnswers({ product_id: productId() })),
		enabled: !!productId(),
	}));
}
