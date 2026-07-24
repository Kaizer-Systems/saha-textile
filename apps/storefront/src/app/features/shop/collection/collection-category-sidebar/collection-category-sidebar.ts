import { Component, inject, input } from '@angular/core';

import * as data from '../../../../shared/data/owl-carousel';
import { Params } from '@data-access/interfaces/core.interface';
import { AttributeService } from '@data-access/services/attribute.service';
import { CollectionCategories } from '../widgets/collection-categories/collection-categories';
import { CollectionProducts } from '../widgets/collection-products/collection-products';

@Component({
  selector: 'app-collection-category-sidebar',
  templateUrl: './collection-category-sidebar.html',
  styleUrls: ['./collection-category-sidebar.scss'],
  imports: [CollectionCategories, CollectionProducts],
})
export class CollectionCategorySidebar {
  attributeService = inject(AttributeService);

  readonly filter = input<Params>();

  public categorySlider = data.categorySlider;
}
