import { Component, inject, input, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IProduct } from '@data-access/interfaces/product.interface';
import { IQuestionAnswers } from '@data-access/interfaces/questions-answers.interface';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';
import { QuestionModal } from '@shared/ui/modal/question-modal/question-modal';
import { NoData } from '@shared/ui/no-data/no-data';

/**
 * Answered product questions, server-rendered in the Q&A tab, with the theme's "post your
 * question" link. Questions do not need an account (owner lock); the shop answers them in the
 * admin, and only answered questions appear here.
 */
@Component({
	selector: 'app-questions-answers',
	templateUrl: './questions-answers.html',
	styleUrls: ['./questions-answers.scss'],
	imports: [NoData, QuestionModal, ShopDatePipe, TranslocoModule],
})
export class QuestionsAnswers {
	readonly questionAnswersService = inject(QuestionsAnswersService);

	readonly product = input<IProduct>();
	readonly questionAnswers = input<IQuestionAnswers[]>();

	readonly QuestionModal = viewChild<QuestionModal>('questionModal');

	public skeletonItems = Array.from({ length: 5 }, (_, index) => index);
}
