import { Component, input, model } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { FormFields } from '@shared/ui/form-fields/form-fields';

export type FaqText = Record<string, string>;

export interface FaqRow {
	/** Present once saved. */
	id?: string;
	question: FaqText;
	answer: FaqText;
}

export interface FaqValue {
	enabled: boolean;
	rows: FaqRow[];
}

const MAX_QUESTIONS = 30;

/**
 * The product form's FAQ tab: the switch that shows the FAQ section on the product page, and
 * this product's own questions. Text follows the form's one Language switch: the fields show the
 * language chosen at the top, like every other field. Theme switch, form rows and buttons only.
 */
@Component({
	selector: 'app-product-faq',
	templateUrl: './product-faq.html',
	imports: [FormFields, TranslocoModule],
})
export class ProductFaq {
	readonly value = model.required<FaqValue>();
	readonly locale = input.required<string>();

	readonly maxQuestions = MAX_QUESTIONS;

	setEnabled(enabled: boolean) {
		this.value.update((value) => ({ ...value, enabled }));
	}

	add() {
		this.value.update((value) =>
			value.rows.length >= MAX_QUESTIONS
				? value
				: { ...value, rows: [...value.rows, { question: {}, answer: {} }] },
		);
	}

	remove(index: number) {
		this.value.update((value) => ({ ...value, rows: value.rows.filter((_, at) => at !== index) }));
	}

	/** Moves a question up (-1) or down (+1); the page shows them in this order. */
	move(index: number, step: -1 | 1) {
		const target = index + step;
		this.value.update((value) => {
			if (target < 0 || target >= value.rows.length) return value;
			const rows = [...value.rows];
			[rows[index], rows[target]] = [rows[target] as FaqRow, rows[index] as FaqRow];
			return { ...value, rows };
		});
	}

	write(index: number, part: 'question' | 'answer', text: string) {
		const locale = this.locale();
		this.value.update((value) => ({
			...value,
			rows: value.rows.map((row, at) =>
				at === index ? { ...row, [part]: { ...row[part], [locale]: text } } : row,
			),
		}));
	}
}
