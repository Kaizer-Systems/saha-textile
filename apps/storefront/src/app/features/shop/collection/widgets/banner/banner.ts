import { Component, input } from '@angular/core';

@Component({
  selector: 'app-collection-category-banner',
  templateUrl: './banner.html',
  styleUrls: ['./banner.scss'],
  imports: [],
})
export class Banner {
  readonly class = input<string | undefined>('banner-contain-2 hover-effect');
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly imageUrl = input<string>();
}
