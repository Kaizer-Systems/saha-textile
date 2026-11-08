import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NotificationService } from '@data-access/services/notification.service';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

import { AnswersModal } from './answers-modal/answers-modal';
import { QuestionsAnswers } from './questions-answers';

const data = signal<unknown>(undefined);
const params: unknown[] = [];
vi.mock('@data-access/queries/questions-answers.queries', () => ({
	ADMIN_QUESTIONS_KEY: 'admin-questions',
	injectQuestionAnswersQuery: (p: () => unknown) => {
		params.push(p);
		return { data };
	},
}));

const row = (overrides: Record<string, unknown> = {}) => ({
	question: {
		id: 'q1',
		productId: 'p1',
		question: 'Is the blouse the same colour?',
		askerName: 'Ananya',
		askerEmail: 'a@example.test',
		answer: null,
		status: 'pending',
		createdAt: '2026-11-08T10:00:00.000Z',
		...overrides,
	},
	productName: 'Maroon saree',
	productSlug: 'maroon-saree',
});

const translate = { translate: vi.fn((key: string) => key), selectTranslate: () => of('') };
const notifications = { showSuccess: vi.fn() };

describe('QuestionsAnswers page', () => {
	const render = () => {
		const service = { reject: vi.fn(() => of({})), remove: vi.fn(() => of({})) };
		const queryClient = new QueryClient();
		vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: QuestionsAnswersService, useValue: service },
				{ provide: QueryClient, useValue: queryClient },
				{ provide: NotificationService, useValue: notifications },
				{ provide: TranslocoService, useValue: translate },
			],
		});
		TestBed.overrideComponent(QuestionsAnswers, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(QuestionsAnswers);
		fixture.detectChanges();
		return { page: fixture.componentInstance, service, queryClient };
	};

	it('shows waiting questions first, with product, asker and status', () => {
		const { page } = render();
		expect((params.at(-1) as () => unknown)()).toEqual({ status: 'pending' });
		data.set({ items: [row(), { ...row({ id: 'q2', answer: 'Yes' }), productName: null }], total: 2 });
		TestBed.tick();
		expect(page.tableConfig().total).toBe(2);
		expect(page.tableConfig().data?.[0]).toMatchObject({
			id: 'q1',
			product_name: 'Maroon saree',
			asked_by: 'Ananya · a@example.test',
			answer: '',
			status: 'question_status_pending',
		});
		expect(page.tableConfig().data?.[1]).toMatchObject({ product_name: 'p1', answer: 'Yes' });
		data.set(undefined);
		TestBed.tick();
		expect(page.tableConfig()).toMatchObject({ data: [], total: 0 });
	});

	it('pages, searches and switches status from the first page', () => {
		const { page } = render();
		page.onTableChange({ page: 2, paginate: 50, search: '  blouse ' });
		expect((params.at(-1) as () => unknown)()).toEqual({
			page: 2,
			pageSize: 50,
			search: 'blouse',
			status: 'pending',
		});
		page.onTableChange({ search: '   ' });
		expect((params.at(-1) as () => unknown)()).toEqual({ status: 'pending' });
		page.onTableChange({ page: 3, search: 'silk' });
		page.onStatusChange({ value: 'answered' } as never);
		expect((params.at(-1) as () => unknown)()).toEqual({
			page: 1,
			pageSize: undefined,
			search: 'silk',
			status: 'answered',
		});
		page.onStatusChange({ value: 'answered' } as never);
		page.onTableChange();
		page.onStatusChange({ value: 'rejected' } as never);
		expect((params.at(-1) as () => unknown)()).toEqual({ page: 1, pageSize: undefined, status: 'rejected' });
		expect(page.statusOptions().map((option) => (option as { value: string }).value)).toEqual([
			'pending',
			'answered',
			'rejected',
		]);
	});

	it('answers, rejects and deletes, refreshing the list', async () => {
		const { page, service, queryClient } = render();
		const openModal = vi.fn();
		Object.defineProperty(page, 'answersModal', { value: () => ({ openModal }) });
		const tableRow = { id: 'q1', source: row() };
		page.onActionClicked({ actionToPerform: 'edit', data: tableRow } as never);
		expect(openModal).toHaveBeenCalledWith(tableRow.source);
		page.onActionClicked({ actionToPerform: 'reject', data: tableRow } as never);
		page.onActionClicked({ actionToPerform: 'delete', data: tableRow } as never);
		page.onActionClicked({ actionToPerform: 'other', data: tableRow } as never);
		await vi.waitFor(() => expect(service.remove).toHaveBeenCalledWith('q1'));
		expect(service.reject).toHaveBeenCalledWith('q1');
		await vi.waitFor(() => expect(notifications.showSuccess).toHaveBeenCalledWith('question_deleted'));
		expect(notifications.showSuccess).toHaveBeenCalledWith('question_rejected');
		page.onAnswered();
		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-questions'] });
	});
});

describe('AnswersModal', () => {
	const render = (result: Promise<unknown> = Promise.resolve('closed')) => {
		const open = vi.fn(() => ({ result }));
		const dismissAll = vi.fn();
		const api = { answer: vi.fn(() => of({})) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbModal, useValue: { open, dismissAll } },
				{ provide: QuestionsAnswersService, useValue: api },
				{ provide: NotificationService, useValue: notifications },
				{ provide: TranslocoService, useValue: translate },
			],
		});
		TestBed.overrideComponent(AnswersModal, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(AnswersModal);
		return { fixture, modal: fixture.componentInstance, dismissAll, api, open };
	};

	it('opens with the saved answer, or empty', async () => {
		const { modal } = render();
		await modal.openModal(row({ answer: 'Yes, matching' }) as never);
		expect(modal.answers.value).toBe('Yes, matching');
		await modal.openModal(row() as never);
		expect(modal.answers.value).toBe('');
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render(Promise.reject(reason));
		await modal.openModal(row() as never);
		await Promise.resolve();
		await Promise.resolve();
		expect(modal.closeResult).toBe(text);
	});

	it('publishes a first answer, corrects a later one, and refuses an empty one', async () => {
		const { modal, api, dismissAll } = render();
		const answered = vi.fn();
		modal.answered.subscribe(answered);
		modal.submit();
		expect(api.answer).not.toHaveBeenCalled();
		await modal.openModal(row() as never);
		modal.answers.setValue('   ');
		modal.submit();
		expect(api.answer).not.toHaveBeenCalled();
		modal.answers.setValue(' Yes, it matches. ');
		modal.submit();
		expect(api.answer).toHaveBeenCalledWith('q1', 'Yes, it matches.');
		expect(notifications.showSuccess).toHaveBeenLastCalledWith('question_answered');
		await modal.openModal(row({ status: 'answered', answer: 'Yes' }) as never);
		modal.submit();
		expect(notifications.showSuccess).toHaveBeenLastCalledWith('answer_updated');
		expect(dismissAll).toHaveBeenCalledTimes(2);
		expect(answered).toHaveBeenCalledTimes(2);
		modal.modalOpen = true;
		modal.ngOnDestroy();
		expect(dismissAll).toHaveBeenCalledTimes(3);
	});
});

describe('QuestionsAnswersService', () => {
	it('lists with the filled params, and answers, rejects and deletes', () => {
		const http = { get: vi.fn(() => of({})), post: vi.fn(() => of({})), delete: vi.fn(() => of({})) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
		const service = TestBed.inject(QuestionsAnswersService);
		service.list({ status: 'pending', search: '', page: 1 }).subscribe();
		expect(http.get).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/catalog\/questions$/), {
			params: { status: 'pending', page: 1 },
			withCredentials: true,
		});
		service.answer('q 1', 'Yes').subscribe();
		expect(http.post).toHaveBeenLastCalledWith(
			expect.stringMatching(/\/questions\/q%201\/answer$/),
			{ answer: 'Yes' },
			{ withCredentials: true },
		);
		service.reject('q1').subscribe();
		expect(http.post).toHaveBeenLastCalledWith(
			expect.stringMatching(/\/questions\/q1\/reject$/),
			{},
			{
				withCredentials: true,
			},
		);
		service.remove('q1').subscribe();
		expect(http.delete).toHaveBeenCalledWith(expect.stringMatching(/\/questions\/q1$/), { withCredentials: true });
	});
});
