/** An answered product question as the shop shows it (`PublicProductQuestion` in the contracts). */
export interface IQuestionAnswers {
	id: string;
	question: string;
	answer: string;
	/** Null when the asker chose to stay anonymous. */
	askerName: string | null;
	answeredAt: string | null;
}

export interface IQnAModel {
	data: IQuestionAnswers[];
	total: number;
}
