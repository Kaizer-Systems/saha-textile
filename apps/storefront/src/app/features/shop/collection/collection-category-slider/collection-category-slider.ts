import { Component, inject, input } from '@angular/core';

import * as data from '../../../../shared/data/owl-carousel';
import { Params } from '@data-access/interfaces/core.interface';
import { AttributeService } from '@data-access/services/attribute.service';
import { CollectionCategories } from '../widgets/collection-categories/collection-categories';
import { CollectionProducts } from '../widgets/collection-products/collection-products';
import { CollectionSidebar } from '../widgets/sidebar/sidebar';

@Component({
  selector: 'app-collection-category-slider',
  templateUrl: './collection-category-slider.html',
  styleUrls: ['./collection-category-slider.scss'],
  imports: [CollectionCategories, CollectionSidebar, CollectionProducts],
})
export class CollectionCategorySlider {
  attributeService = inject(AttributeService);

  readonly filter = input<Params>();

  public categorySlider = data.categorySlider;
}
