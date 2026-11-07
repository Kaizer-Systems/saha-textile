import { Component, computed, effect, inject, input } from '@angular/core';

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

import { childCategories } from '@core/catalog/category-scope';
import { Params } from '@data-access/interfaces/core.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectCatalogQuery } from '@data-access/queries/product.queries';
import { AttributeService } from '@data-access/services/attribute.service';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

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
		TitleCasePipe,
		TranslocoModule,
	],
})
export class CollectionSidebar {
	private readonly categoriesQuery = injectCategoriesQuery();
	/** A last-level category has nothing to narrow, so the Categories filter steps aside. */
	readonly hasChildCategories = computed(
		() => childCategories(this.categoriesQuery.data()?.data ?? [], this.filter()?.['path']).length > 0,
	);

	attributeService = inject(AttributeService);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly filter = input<Params>();

	// Facets ride along on the same catalog query the list uses (shared cache key),
	// so their disjunctive counts always match the current filter — no extra fetch.
	private readonly catalogQuery = injectCatalogQuery(() => this.filter());
	readonly facets = computed(() => this.catalogQuery.data()?.facets ?? {});
	readonly facetKeys = computed(() => Object.keys(this.facets()));
	readonly facetLabels = computed(() => this.catalogQuery.data()?.facetLabels ?? {});

	constructor() {
		// Drive the sidebar skeleton off the catalog query's first load.
		effect(() => {
			this.attributeService.skeletonLoader = this.catalogQuery.isPending();
		});
	}

	closeCanvasMenu() {
		this.attributeService.offCanvasMenu = false;
	}
}
