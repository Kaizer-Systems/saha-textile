import { AsyncPipe } from '@angular/common';
import { Component, inject, input, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { Observable, Subject } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IQnAModel, IQuestionAnswers } from '@data-access/interfaces/questions-answers.interface';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { QuestionModal } from '@shared/ui/modal/question-modal/question-modal';
import { NoData } from '@shared/ui/no-data/no-data';

@Component({
	selector: 'app-questions-answers',
	templateUrl: './questions-answers.html',
	styleUrls: ['./questions-answers.scss'],
	imports: [NoData, QuestionModal, AsyncPipe, TranslocoModule],
})
export class QuestionsAnswers {
	private authStore = inject(AuthStore);
	private accountStore = inject(AccountStore);
	private queryClient = injectQueryClient();
	questionAnswersService = inject(QuestionsAnswersService);

	public user: IAccountUser;
	public question = new FormControl();
	public isLogin: boolean = false;
	public skeletonItems = Array.from({ length: 5 }, (_, index) => index);
	private destroy$ = new Subject<void>();

	readonly product = input<IProduct>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly questionAnswers = input<IQuestionAnswers[]>();

	readonly QuestionModal = viewChild<QuestionModal>('questionModal');

	user$: Observable<IAccountUser> = toObservable(this.accountStore.user) as Observable<IAccountUser>;

	constructor() {
		// Presentation only. Product Q&A does not require login (owner lock); this just
		// decides whether the identity fields are prefilled.
		this.isLogin = this.authStore.isAuthenticated();
		if (this.isLogin) {
			this.accountStore.loadUser();
		}
	}

	// Optimistic like/dislike on the cached Q&A list (was the NGXS FeedbackAction
	// reducer). No backend yet — mutate the ['qna', productId] query cache in place.
	feedback(qna: IQuestionAnswers, value: string) {
		const productId = this.product()?.id;
		this.queryClient.setQueryData<IQnAModel>(['qna', productId], (old) => {
			if (!old) return old;
			const data = old.data.map((q) => ({ ...q }));
			const index = data.findIndex((item) => Number(item.id) === Number(qna.id));
			if (index === -1) return old;

			const currentReaction = data[index].reaction;
			if (currentReaction === value) {
				if (value === 'liked') data[index].total_likes -= 1;
				else data[index].total_dislikes -= 1;
				data[index].reaction = null;
			} else {
				if (currentReaction === 'liked') data[index].total_likes -= 1;
				else if (currentReaction === 'disliked') data[index].total_dislikes -= 1;
				if (value === 'liked') data[index].total_likes += 1;
				else data[index].total_dislikes += 1;
				data[index].reaction = value;
			}
			return { ...old, data };
		});
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
