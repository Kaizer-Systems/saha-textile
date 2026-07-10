import { Component, computed, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { Observable } from 'rxjs';

import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';

@Component({
  selector: 'app-collection-category-filter',
  templateUrl: './collection-category-filter.html',
  styleUrls: ['./collection-category-filter.scss'],
  imports: [],
})
export class CollectionCategoryFilter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private readonly categoriesQuery = injectCategoriesQuery(() => ({ status: 1 }));
  category$: Observable<ICategoryModel> = toObservable(
    computed(() => this.categoriesQuery.data() ?? { data: [], total: 0 }),
  );

  readonly filter = input<Params>();

  public categories: ICategory[];
  public selectedCategories: string[] = [];

  constructor() {
    this.category$.subscribe(
      res => (this.categories = res?.data?.filter(category => category.type == 'product')),
    );
  }

  ngOnChanges() {
    const filter = this.filter();
    this.selectedCategories = filter!['category'] ? filter!['category'].split(',') : [];
  }

  applyFilter(event: Event) {
    const index = this.selectedCategories.indexOf((<HTMLInputElement>event?.target)?.value); // checked and unchecked value

    if ((<HTMLInputElement>event?.target)?.checked)
      this.selectedCategories.push((<HTMLInputElement>event?.target)?.value); // push in array cheked value
    else this.selectedCategories.splice(index, 1); // removed in array unchecked value

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        category: this.selectedCategories.length ? this.selectedCategories.join(',') : null,
      },
      queryParamsHandling: 'merge', // preserve the existing query params in the route
      skipLocationChange: false, // do trigger navigation
    });
  }

  // check if the item are selected
  checked(item: string) {
    if (this.selectedCategories?.indexOf(item) != -1) {
      return true;
    }
    return false;
  }
}
