import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IOption } from '@data-access/interfaces/theme-option.interface';
import { IFooter } from '@data-access/interfaces/theme.interface';
import { About } from '../widgets/about/about';
import { FooterCategories } from '../widgets/categories/categories';
import { Contact } from '../widgets/contact/contact';
import { Copyright } from '../widgets/copyright/copyright';
import { Links } from '../widgets/links/links';
import { FooterLogo } from '../widgets/logo/logo';
import { PaymentOptions } from '../widgets/payment-options/payment-options';
import { SocialLinks } from '../widgets/social-links/social-links';

@Component({
  selector: 'app-basic-footer',
  templateUrl: './basic-footer.html',
  styleUrls: ['./basic-footer.scss'],
  imports: [
    FooterLogo,
    About,
    FooterCategories,
    Links,
    Contact,
    Copyright,
    PaymentOptions,
    SocialLinks,
    TranslateModule,
  ],
})
export class BasicFooter {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IOption | null>();
  readonly footer = input<IFooter>();

  public active: { [key: string]: boolean } = {
    categories: false,
    useful_link: false,
    help_center: false,
  };

  toggle(value: string) {
    this.active[value] = !this.active[value];
  }
}
