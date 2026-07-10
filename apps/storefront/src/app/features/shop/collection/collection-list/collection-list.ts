import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Params } from '@angular/router';

import { Observable } from 'rxjs';

import { IOption } from '@data-access/interfaces/theme-option.interface';
import { AttributeService } from '@data-access/services/attribute.service';
import { ThemeOptionStore } from '@core/state/theme-option.store';
import { Banner } from '../widgets/banner/banner';
import { CollectionProducts } from '../widgets/collection-products/collection-products';
import { CollectionSidebar } from '../widgets/sidebar/sidebar';

@Component({
  selector: 'app-collection-list',
  templateUrl: './collection-list.html',
  styleUrls: ['./collection-list.scss'],
  imports: [Banner, CollectionSidebar, CollectionProducts],
})
export class CollectionList {
  attributeService = inject(AttributeService);

  themeOptions$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;

  readonly filter = input<Params>();

  public bannerImageUrl: string;

  constructor() {
    this.themeOptions$.subscribe(
      res => (this.bannerImageUrl = res?.collection?.collection_banner_image_url),
    );
  }
}
