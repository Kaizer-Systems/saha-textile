import { Component, inject, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { AttributeService } from '@data-access/services/attribute.service';
import { ThemeOptionState } from '@data-access/states/theme-option.state';
import { Banner } from '../widgets/banner/banner';
import { CollectionProducts } from '../widgets/collection-products/collection-products';
import { CollectionSidebar } from '../widgets/sidebar/sidebar';

@Component({
  selector: 'app-collection-right-sidebar',
  templateUrl: './collection-right-sidebar.html',
  styleUrls: ['./collection-right-sidebar.scss'],
  imports: [Banner, CollectionProducts, CollectionSidebar],
})
export class CollectionRightSidebar {
  attributeService = inject(AttributeService);

  themeOptions$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;

  readonly filter = input<Params>();

  public bannerImageUrl: string;

  constructor() {
    this.themeOptions$.subscribe(
      res => (this.bannerImageUrl = res?.collection?.collection_banner_image_url),
    );
  }
}
