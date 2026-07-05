import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IOption } from '@data-access/interfaces/theme-option.interface';

@Component({
  selector: 'app-footer-social-links',
  templateUrl: './social-links.html',
  styleUrls: ['./social-links.scss'],
  imports: [TranslateModule],
})
export class SocialLinks {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IOption | null>();
}
