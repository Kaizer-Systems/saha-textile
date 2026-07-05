import { AsyncPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { FormCategory } from './form-category/form-category';
import { Tree } from './tree/tree';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { ICategoryModel } from '@data-access/interfaces/category.interface';

@Component({
	selector: 'app-category',
	templateUrl: './category.html',
	styleUrls: ['./category.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Tree, FormCategory, TranslateModule, AsyncPipe],
})
export class Category {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly type = input<string>('create');
	readonly categoryType = input<string | null>('product');

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: this.categoryType() }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);
}
