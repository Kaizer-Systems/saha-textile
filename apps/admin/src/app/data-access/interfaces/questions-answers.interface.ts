/**
 * Product questions as OUR admin API returns them, mirroring `AdminQuestionListResponse` in
 * `packages/contracts`. The asker's email is shown to the admin only.
 */
export type QuestionStatus = 'pending' | 'answered' | 'rejected';

export interface IAdminQuestion {
	id: string;
	productId: string;
	question: string;
	askerName: string;
	askerEmail: string;
	isAnonymous: boolean;
	answer: string | null;
	answeredAt: string | null;
	status: QuestionStatus;
	createdAt?: string;
}

export interface IAdminQuestionRow {
	question: IAdminQuestion;
	productName: string | null;
	productSlug: string | null;
}

export interface IAdminQuestionPage {
	items: IAdminQuestionRow[];
	total: number;
	page: number;
	pageSize: number;
}

export interface IAdminQuestionListParams {
	status?: QuestionStatus;
	search?: string;
	page?: number;
	pageSize?: number;
}
