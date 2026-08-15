import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { Params, Router } from '@angular/router';

import { IQuestionAnswers } from '@data-access/interfaces/questions-answers.interface';
import { IStores } from '@data-access/interfaces/store.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectQuestionAnswersQuery } from '@data-access/queries/questions-answers.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';

import { AnswersModal } from './answers-modal/answers-modal';

@Component({
	selector: 'app-questions-answers',
	templateUrl: './questions-answers.html',
	styleUrls: ['./questions-answers.scss'],
	imports: [PageWrapper, Table, AnswersModal],
})
export class QuestionsAnswers {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly questionAnswersQuery = injectQuestionAnswersQuery(() => this.params());

	readonly AnswersModal = viewChild<AnswersModal>('answersModal');

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'Question', dataField: 'question' },
			{
				title: 'created_at',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
		],
		rowActions: [
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'question_and_answer.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'question_and_answer.destroy',
			},
		],
		data: [] as IQuestionAnswers[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const questionAnswers = this.questionAnswersQuery.data();
			this.tableConfig.data = questionAnswers?.data ? questionAnswers.data : [];
			this.tableConfig.total = questionAnswers?.total ? questionAnswers.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') void this.AnswersModal().openModal(action.data);
		else if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
	}

	delete(_data: IStores) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
