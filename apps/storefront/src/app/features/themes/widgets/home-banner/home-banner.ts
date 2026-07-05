import { Component, input } from '@angular/core';

import { ImageLink } from '@shared/ui/image-link/image-link';

@Component({
  selector: 'app-theme-home-banner',
  templateUrl: './home-banner.html',
  styleUrls: ['./home-banner.scss'],
  imports: [ImageLink],
})
export class HomeBanner {
  readonly theme = input<string>('paris');
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<any>();
}
