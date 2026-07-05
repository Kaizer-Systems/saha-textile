import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';

import {
  NgbAccordionBody,
  NgbAccordionButton,
  NgbAccordionCollapse,
  NgbAccordionDirective,
  NgbAccordionHeader,
  NgbAccordionItem,
  NgbAccordionToggle,
  NgbCollapse,
} from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetAttributesAction } from '@data-access/actions/attribute.action';
import { IAttributeModel } from '@data-access/interfaces/attribute.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { AttributeService } from '@data-access/services/attribute.service';
import { AttributeState } from '@data-access/states/attribute.state';
import { CollectionAttributes } from '../filter/collection-attributes-filter/collection-attributes-filter';
import { CollectionCategoryFilter } from '../filter/collection-category-filter/collection-category-filter';
import { CollectionFilter } from '../filter/collection-filter/collection-filter';
import { CollectionPriceFilter } from '../filter/collection-price-filter/collection-price-filter';
import { CollectionRatingFilter } from '../filter/collection-rating-filter/collection-rating-filter';
import { SkeletonCollectionSidebar } from '../skeleton-collection-sidebar/skeleton-collection-sidebar';

@Component({
  selector: 'app-collection-sidebar',
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
  imports: [
    CollectionFilter,
    SkeletonCollectionSidebar,
    NgbAccordionDirective,
    NgbAccordionItem,
    NgbAccordionHeader,
    NgbAccordionToggle,
    NgbAccordionButton,
    NgbCollapse,
    NgbAccordionCollapse,
    NgbAccordionBody,
    CollectionCategoryFilter,
    CollectionAttributes,
    CollectionPriceFilter,
    CollectionRatingFilter,
    AsyncPipe,
    TranslateModule,
  ],
})
export class CollectionSidebar {
  private store = inject(Store);
  attributeService = inject(AttributeService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly filter = input<Params>();

  attribute$: Observable<IAttributeModel> = inject(Store).select(AttributeState.attribute);

  constructor() {
    this.store.dispatch(new GetAttributesAction({ status: 1 }));
  }

  closeCanvasMenu() {
    this.attributeService.offCanvasMenu = false;
  }
}
