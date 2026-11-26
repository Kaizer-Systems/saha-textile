import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule, TranslocoService, translateSignal } from '@jsverse/transloco';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2UpdateEvent } from 'ng-select2-component';
import { lastValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import {
	IAdminQuestionListParams,
	IAdminQuestionRow,
	QuestionStatus,
} from '@data-access/interfaces/questions-answers.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { ADMIN_QUESTIONS_KEY, injectQuestionAnswersQuery } from '@data-access/queries/questions-answers.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';

import { AnswersModal } from './answers-modal/answers-modal';

/** One table row: the API row flattened into the theme table's columns. */
export interface QuestionTableRow {
	id: string;
	question: string;
	product_name: string;
	asked_by: string;
	answer: string;
	status: string;
	created_at?: string;
	source: IAdminQuestionRow;
}

/**
 * Product questions for moderation (owner log § Reviews, FAQ, and Q&A; product page brief).
 * A status filter in the page header (the customer list's filter), search, paging, and row
 * actions: Answer (or correct the answer), Reject (hides it for good) and Delete. Answering the
 * first time publishes the question and emails the asker.
 */
@Component({
	selector: 'app-questions-answers',
	templateUrl: './questions-answers.html',
	styleUrls: ['./questions-answers.scss'],
	imports: [PageWrapper, Table, AnswersModal, Select2, TranslocoModule],
})
export class QuestionsAnswers {
	private readonly service = inject(QuestionsAnswersService);
	private readonly queryClient = injectQueryClient();
	private readonly notifications = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly status = signal<QuestionStatus>('pending');
	private readonly params = signal<IAdminQuestionListParams>({});
	readonly questionsQuery = injectQuestionAnswersQuery(() => ({ ...this.params(), status: this.status() }));

	readonly answersModal = viewChild<AnswersModal>('answersModal');

	private readonly pendingLabel = translateSignal('question_status_pending');
	private readonly answeredLabel = translateSignal('question_status_answered');
	private readonly rejectedLabel = translateSignal('question_status_rejected');
	readonly statusOptions = computed<Select2Data>(() => [
		{ value: 'pending', label: this.pendingLabel() },
		{ value: 'answered', label: this.answeredLabel() },
		{ value: 'rejected', label: this.rejectedLabel() },
	]);

	private readonly baseConfig: ITableConfig<QuestionTableRow> = {
		columns: [
			{ title: 'question', dataField: 'question' },
			{ title: 'product_name', dataField: 'product_name' },
			{ title: 'asked_by', dataField: 'asked_by' },
			{ title: 'answer', dataField: 'answer' },
			{ title: 'status', dataField: 'status' },
			{ title: 'created_at', dataField: 'created_at', type: 'date' },
		],
		rowActions: [
			{
				label: 'answer',
				actionToPerform: 'edit',
				icon: 'ri-question-answer-line',
				permission: 'question_and_answer.edit',
			},
			{
				label: 'reject',
				actionToPerform: 'reject',
				icon: 'ri-eye-off-line',
				permission: 'question_and_answer.edit',
				confirm: true,
			},
			{
				label: 'delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'question_and_answer.destroy',
			},
		],
		data: [],
		total: 0,
	};

	readonly tableConfig = signal<ITableConfig<QuestionTableRow>>(this.baseConfig);

	private readonly refresh = () => this.queryClient.invalidateQueries({ queryKey: [ADMIN_QUESTIONS_KEY] });

	private readonly rejectMutation = injectMutation(() => ({
		mutationFn: (id: string) => lastValueFrom(this.service.reject(id)),
		onSuccess: () => {
			void this.refresh();
			this.notifications.showSuccess(this.transloco.translate('question_rejected'));
		},
	}));

	private readonly deleteMutation = injectMutation(() => ({
		mutationFn: (id: string) => lastValueFrom(this.service.remove(id)),
		onSuccess: () => {
			void this.refresh();
			this.notifications.showSuccess(this.transloco.translate('question_deleted'));
		},
	}));

	constructor() {
		effect(() => {
			const page = this.questionsQuery.data();
			const data = (page?.items ?? []).map((row): QuestionTableRow => ({
				id: row.question.id,
				question: row.question.question,
				product_name: row.productName ?? row.question.productId,
				asked_by: `${row.question.askerName} · ${row.question.askerEmail}`,
				answer: row.question.answer ?? '',
				status: this.transloco.translate(`question_status_${row.question.status}`),
				created_at: row.question.createdAt,
				source: row,
			}));
			// A signal, not a field write: the zoneless app only re-renders on a signal change.
			this.tableConfig.set({ ...this.baseConfig, data, total: page?.total ?? 0 });
		});
	}

	onTableChange(data?: Params) {
		const next: IAdminQuestionListParams = {};
		if (data?.['page'] !== undefined) next.page = Number(data['page']);
		if (data?.['paginate'] !== undefined) next.pageSize = Number(data['paginate']);
		if (typeof data?.['search'] === 'string' && data['search'].trim()) next.search = data['search'].trim();
		this.params.set(next);
	}

	onStatusChange(event: Select2UpdateEvent) {
		const next = event.value as QuestionStatus;
		if (next === this.status()) return;
		this.status.set(next);
		this.params.update(({ search, pageSize }) => ({ page: 1, pageSize, ...(search ? { search } : {}) }));
	}

	onActionClicked(action: ITableClickedAction) {
		const row = action.data as QuestionTableRow;
		if (action.actionToPerform === 'edit') void this.answersModal()?.openModal(row.source);
		else if (action.actionToPerform === 'reject') this.rejectMutation.mutate(row.id);
		else if (action.actionToPerform === 'delete') this.deleteMutation.mutate(row.id);
	}

	onAnswered() {
		void this.refresh();
	}
}
