import { AsyncPipe } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
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
import { Observable } from 'rxjs';

import { IAttributeModel } from '@data-access/interfaces/attribute.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { injectAttributesQuery } from '@data-access/queries/attribute.queries';
import { AttributeService } from '@data-access/services/attribute.service';

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
		TranslocoModule,
	],
})
export class CollectionSidebar {
	attributeService = inject(AttributeService);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly filter = input<Params>();

	private readonly attributesQuery = injectAttributesQuery(() => ({ status: 1 }));
	attribute$: Observable<IAttributeModel | undefined> = toObservable(computed(() => this.attributesQuery.data()));

	constructor() {
		// Drive the sidebar skeleton off the query (was AttributeService.skeletonLoader).
		effect(() => {
			this.attributeService.skeletonLoader = this.attributesQuery.isPending();
		});
	}

	closeCanvasMenu() {
		this.attributeService.offCanvasMenu = false;
	}
}
