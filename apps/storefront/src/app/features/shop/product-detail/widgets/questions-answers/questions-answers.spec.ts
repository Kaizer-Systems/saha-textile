import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

import { QuestionsAnswers } from './questions-answers';

describe('QuestionsAnswers', () => {
	it('shows the answered questions it is given, with the shared loading flag', () => {
		const service = { skeletonLoader: true };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: QuestionsAnswersService, useValue: service }] });
		TestBed.overrideComponent(QuestionsAnswers, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(QuestionsAnswers);
		const rows = [{ id: 'q1', question: 'Silk?', answer: 'Yes', askerName: null, answeredAt: null }];
		fixture.componentRef.setInput('questionAnswers', rows);
		expect(fixture.componentInstance.questionAnswers()).toEqual(rows);
		expect(fixture.componentInstance.questionAnswersService.skeletonLoader).toBe(true);
		expect(fixture.componentInstance.skeletonItems).toHaveLength(5);
	});
});
