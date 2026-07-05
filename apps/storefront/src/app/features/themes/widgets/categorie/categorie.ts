import { Component, output, input } from '@angular/core';

import { OwlOptions } from 'ngx-owl-carousel-o';

import { Categories } from '@shared/ui/categories/categories';

@Component({
  selector: 'app-theme-categorie',
  templateUrl: './categorie.html',
  styleUrls: ['./categorie.scss'],
  imports: [Categories],
})
export class Categorie {
  readonly categoryIds = input<number[]>([]);
  readonly style = input<string>('vertical');
  readonly title = input<string>();
  readonly image = input<string>();
  readonly theme = input<string>();
  readonly sliderOption = input<OwlOptions>();
  readonly selectedCategoryId = input<number>();

  readonly selectedCategory = output<number>();

  constructor() {}

  selectCategory(id: number) {
    this.selectedCategory.emit(id);
  }
}
