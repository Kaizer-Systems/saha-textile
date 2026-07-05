import { Component, inject, input, SimpleChanges } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { CategoryState } from '@data-access/states/category.state';

@Component({
  selector: 'app-footer-categories',
  templateUrl: './categories.html',
  styleUrls: ['./categories.scss'],
  imports: [RouterLink],
})
export class FooterCategories {
  readonly data = input<IOption | null>();

  category$: Observable<ICategoryModel> = inject(Store).select(
    CategoryState.category,
  ) as Observable<ICategoryModel>;

  public categories: ICategory[];

  ngOnChanges(changes: SimpleChanges) {
    const ids = changes['data']?.currentValue?.footer?.footer_categories;
    if (Array.isArray(ids)) {
      this.category$.subscribe(categories => {
        if (Array.isArray(categories.data)) {
          this.categories = categories.data.filter(category => ids?.includes(category.id));
        }
      });
    }
  }
}
