import { AsyncPipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { injectMissingLanguage } from '@core/i18n/missing-language';
import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { MissingLanguageNotice } from '@shared/ui/missing-language-notice/missing-language-notice';

import { FormCategory } from './form-category/form-category';
import { Tree } from './tree/tree';

@Component({
	selector: 'app-category',
	templateUrl: './category.html',
	styleUrls: ['./category.scss'],
	imports: [
		MissingLanguageNotice,
		PageWrapper,
		HasPermissionDirective,
		RouterModule,
		Tree,
		FormCategory,
		TranslocoModule,
		AsyncPipe,
	],
})
export class Category {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly type = input<string>('create');
	readonly categoryType = input<string | null>('product');
	readonly locale = signal('en');

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: this.categoryType() }));
	/** Opened from Settings › Languages: only categories still missing one language's text. */
	private readonly missingShop = injectMissingLanguage('categories');
	private readonly missingBlog = injectMissingLanguage('blog_categories');
	readonly missing = computed(() => (this.categoryType() === 'post' ? this.missingBlog : this.missingShop));
	private readonly shown = computed(() => {
		const model = this.categoriesQuery.data();
		const ids = this.missing().ids();
		return model && ids ? { ...model, data: keepBranches(model.data, ids) } : model;
	});
	category$: Observable<ICategoryModel | undefined> = toObservable(this.shown);
}

/** The categories in `ids`, with the parents that lead to them, so the tree keeps its shape. */
export function keepBranches(nodes: readonly ICategory[], ids: ReadonlySet<string>): ICategory[] {
	return nodes.flatMap((node) => {
		const children = keepBranches(node.subcategories ?? [], ids);
		return ids.has(String(node.id)) || children.length ? [{ ...node, subcategories: children }] : [];
	});
}
