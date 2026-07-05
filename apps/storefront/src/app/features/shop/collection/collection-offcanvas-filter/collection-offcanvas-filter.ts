import { Component, inject, input } from '@angular/core';

import { Params } from '@data-access/interfaces/core.interface';
import { AttributeService } from '@data-access/services/attribute.service';
import { CollectionProducts } from '../widgets/collection-products/collection-products';
import { CollectionSidebar } from '../widgets/sidebar/sidebar';

@Component({
  selector: 'app-collection-offcanvas-filter',
  templateUrl: './collection-offcanvas-filter.html',
  styleUrls: ['./collection-offcanvas-filter.scss'],
  imports: [CollectionSidebar, CollectionProducts],
})
export class CollectionOffCanvasFilter {
  attributeService = inject(AttributeService);

  readonly filter = input<Params>();

  closeCanvasMenu() {
    this.attributeService.offCanvasMenu = false;
  }
}
