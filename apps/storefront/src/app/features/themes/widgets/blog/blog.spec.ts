import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { BlogService } from '@data-access/services/blog.service';

import { Blog } from './blog';

const model = (...ids: number[]) => ({ data: ids.map((id) => ({ id }) as IBlog) }) as IBlogModel;

/**
 * The server renders this widget, so its state has to live in signals: a plain field written
 * from a subscription left the placeholders in the server HTML. The real template (carousel,
 * router links) is replaced with a thin one that reads the same bindings.
 */
function harness(blogIds: number[]) {
	const responses: Subject<IBlogModel>[] = [];
	const client = new QueryClient();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(client),
			{
				provide: BlogService,
				useValue: {
					getBlogs: () => {
						const response = new Subject<IBlogModel>();
						responses.push(response);
						return response;
					},
				},
			},
		],
	});
	TestBed.overrideComponent(Blog, {
		set: {
			imports: [],
			template: `@if (loading()) {<p class="placeholder"></p>} @else {
				@for (blog of blogs(); track blog.id) {<p class="card">{{ blog.id }}</p>}
			}`,
		},
	});
	const fixture = TestBed.createComponent(Blog);
	fixture.componentRef.setInput('blogIds', blogIds);
	fixture.autoDetectChanges();
	const el: HTMLElement = fixture.nativeElement;
	const cards = () => [...el.querySelectorAll('.card')].map((card) => card.textContent);
	const answer = (value: IBlogModel) => {
		const response = responses.at(-1);
		response?.next(value);
		response?.complete();
	};
	return { client, el, cards, answer, responses, blog: fixture.componentInstance };
}

describe('the home blog rail', () => {
	it('has no posts before the first answer', () => {
		expect(harness([1]).blog.blogs()).toEqual([]);
	});

	it('shows placeholders until the first data, then only the chosen posts', async () => {
		const { el, cards, answer, responses } = harness([2, 3]);

		await vi.waitFor(() => expect(responses).toHaveLength(1));
		expect(el.querySelectorAll('.placeholder')).toHaveLength(1);

		answer(model(1, 2, 3));

		await vi.waitFor(() => expect(cards()).toEqual(['2', '3']));
		expect(el.querySelector('.placeholder')).toBeNull();
	});

	it('keeps the cards on screen during a background refetch', async () => {
		const { client, el, cards, answer, responses } = harness([1]);
		await vi.waitFor(() => expect(responses).toHaveLength(1));
		answer(model(1));
		await vi.waitFor(() => expect(cards()).toEqual(['1']));

		void client.invalidateQueries();

		await vi.waitFor(() => expect(responses).toHaveLength(2));
		expect(cards()).toEqual(['1']);
		expect(el.querySelector('.placeholder')).toBeNull();
	});
});
