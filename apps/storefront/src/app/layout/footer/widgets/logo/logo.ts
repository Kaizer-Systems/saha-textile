import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IOption } from '@data-access/interfaces/theme-option.interface';
import { IFooter } from '@data-access/interfaces/theme.interface';

@Component({
  selector: 'app-footer-logo',
  templateUrl: './logo.html',
  styleUrls: ['./logo.scss'],
  imports: [RouterLink],
})
export class FooterLogo {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IOption>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly footer = input<IFooter>();
}
