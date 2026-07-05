import { isPlatformBrowser } from '@angular/common';
import { Component, SimpleChanges, PLATFORM_ID, inject, output, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Select2Data, Select2UpdateEvent, Select2Module } from 'ng-select2-component';

import { Params } from '@data-access/interfaces/core.interface';
import { AttributeService } from '@data-access/services/attribute.service';

@Component({
  selector: 'app-collection-sort',
  templateUrl: './collection-sort.html',
  styleUrls: ['./collection-sort.scss'],
  imports: [Select2Module, TranslateModule],
})
export class CollectionSort {
  private route = inject(ActivatedRoute);
  private attributeService = inject(AttributeService);
  private router = inject(Router);
  private platformId = inject<Object>(PLATFORM_ID);

  readonly filter = input<Params>();
  readonly gridCol = input<string>();

  readonly setGridClass = output<string>();
  readonly showFilter = output<boolean>();

  public isBrowser: boolean;

  public sorting: Select2Data = [
    {
      value: 'asc',
      label: 'Ascending Order',
    },
    {
      value: 'desc',
      label: 'Descending Order',
    },
    {
      value: 'low-high',
      label: 'Low - High Price',
    },
    {
      value: 'high-low',
      label: 'High - Low Price',
    },
    {
      value: 'a-z',
      label: 'A - Z Order',
    },
    {
      value: 'z-a',
      label: 'Z - A Order',
    },
    {
      value: 'discount-high-low',
      label: '% Off - Hight To Low',
    },
  ];

  public selectedGrid: string = 'collection_4_grid';
  public class: string =
    'row g-sm-4 g-3 row-cols-xxl-4 row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2 product-list-section';
  public gridArray = [
    'collection_3_grid',
    'collection_4_grid',
    'collection_5_grid',
    'collection_list_view',
  ];
  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.setGridClass.emit(this.class);
  }

  ngOnChanges(changes: SimpleChanges) {
    let layout = changes['filter']?.currentValue.layout;
    let gridCol = changes['gridCol']?.currentValue;
    if (this.gridArray.includes(gridCol)) {
      this.selectedGrid = String(this.grid(gridCol));
    }

    if (this.gridArray.includes(layout)) {
      this.grid(layout);
    }
  }

  grid(value: string) {
    if (this.gridArray.includes(value)) {
      if (value == 'collection_3_grid')
        this.class =
          'row g-sm-4 g-3 product-list-section row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2';
      else if (value == 'collection_4_grid')
        this.class =
          'row g-sm-4 g-3 product-list-section row-cols-xxl-4 row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2';
      else if (value == 'collection_5_grid')
        this.class =
          'row g-sm-4 g-3 product-list-section row-cols-xl-5 row-cols-lg-4 row-cols-md-3 row-cols-2';
      else if (value == 'collection_list_view')
        this.class =
          'row g-sm-4 g-3 product-list-section row-cols-xxl-4 row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2 list-style';

      this.selectedGrid = value;
      this.setGridClass.emit(this.class);
    }
  }

  // SortBy Filter
  sortByFilter(data: Select2UpdateEvent) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sortBy: data && data.value ? data.value : null,
        field: data && (data.value == 'asc' || data.value == 'desc') ? 'created_at' : null,
      },
      queryParamsHandling: 'merge', // preserve the existing query params in the route
      skipLocationChange: false, // do trigger navigation
    });
  }

  openOffCanvasMenu() {
    this.attributeService.offCanvasMenu = true;
  }

  openFilter(value: boolean) {
    this.attributeService.offCanvasMenu = value;
  }
}
