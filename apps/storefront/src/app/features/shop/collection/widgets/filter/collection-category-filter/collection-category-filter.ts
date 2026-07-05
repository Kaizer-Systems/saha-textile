import { Component, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { CategoryState } from '@data-access/states/category.state';

@Component({
  selector: 'app-collection-category-filter',
  templateUrl: './collection-category-filter.html',
  styleUrls: ['./collection-category-filter.scss'],
  imports: [],
})
export class CollectionCategoryFilter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  category$: Observable<ICategoryModel> = inject(Store).select(CategoryState.category);

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
