import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { QueryClient } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

import { QuestionsAnswers } from './questions-answers';

interface Row {
	id: number;
	total_likes: number;
	total_dislikes: number;
	reaction: string | null;
}

const render = (signedIn = false, rows: Row[] | null = []) => {
	const account = { user: signal(null), loadUser: vi.fn() };
	const client = new QueryClient();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: { isAuthenticated: signal(signedIn) } },
			{ provide: AccountStore, useValue: account },
			{ provide: QuestionsAnswersService, useValue: {} },
			{ provide: QueryClient, useValue: client },
		],
	});
	TestBed.overrideComponent(QuestionsAnswers, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(QuestionsAnswers);
	fixture.componentRef.setInput('product', { id: 7 });
	if (rows) client.setQueryData(['qna', 7], { data: rows });
	const read = () => (client.getQueryData(['qna', 7]) as { data: Row[] }).data[0];
	return { fixture, qna: fixture.componentInstance, account, read, client };
};
const row = (reaction: string | null): Row => ({ id: 1, total_likes: 5, total_dislikes: 5, reaction });

describe('QuestionsAnswers', () => {
	it('loads the account only for a signed-in visitor', () => {
		expect(render(true).account.loadUser).toHaveBeenCalledOnce();
		expect(render(false).account.loadUser).not.toHaveBeenCalled();
	});

	it.each([
		[null, 'liked', 6, 5, 'liked'],
		[null, 'disliked', 5, 6, 'disliked'],
		['liked', 'liked', 4, 5, null],
		['disliked', 'disliked', 5, 4, null],
		['liked', 'disliked', 4, 6, 'disliked'],
		['disliked', 'liked', 6, 4, 'liked'],
	])('moves the counts from %s on pressing %s', (from, value, likes, dislikes, reaction) => {
		const { qna, read } = render(false, [row(from)]);
		qna.feedback({ id: 1 } as never, value);
		expect(read()).toMatchObject({ total_likes: likes, total_dislikes: dislikes, reaction });
	});

	it('leaves the cache alone for an unknown question or none cached', () => {
		const { qna, read } = render(false, [row(null)]);
		qna.feedback({ id: 2 } as never, 'liked');
		expect(read()).toMatchObject({ total_likes: 5, reaction: null });
		const empty = render(false, null);
		empty.qna.feedback({ id: 1 } as never, 'liked');
		expect(empty.client.getQueryData(['qna', 7])).toBeUndefined();
	});

	it('cleans up when destroyed', () => {
		const { fixture } = render();
		expect(() => fixture.destroy()).not.toThrow();
	});
});
