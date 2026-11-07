import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

/**
 * TanStack Query for a product's Q&A (replaces NGXS QuestionAnswersState +
 * GetQuestionAnswersAction). Keyed on product slug, the only key the API accepts.
 * The old FeedbackAction (local like/dislike mutation) is now an optimistic
 * queryClient.setQueryData on ['qna', slug] from the display widget.
 */
export function injectQuestionAnswersQuery(productSlug: () => string | undefined) {
	const service = inject(QuestionsAnswersService);
	return injectQuery(() => ({
		queryKey: ['qna', productSlug()],
		queryFn: () => firstValueFrom(service.getQuestionAnswers({ slug: productSlug() })),
		enabled: !!productSlug(),
	}));
}
