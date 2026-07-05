import { isPlatformBrowser } from '@angular/common';
import { Component, HostListener, PLATFORM_ID, inject, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IOption } from '@data-access/interfaces/theme-option.interface';
import { Button } from '@shared/ui/button/button';
import { Menu } from '@shared/ui/menu/menu';
import { Cart } from '../widgets/cart/cart';
import { Logo } from '../widgets/logo/logo';
import { MyAccount } from '../widgets/my-account/my-account';
import { NavbarMenuButton } from '../widgets/navbar-menu-button/navbar-menu-button';
import { Search } from '../widgets/search/search';
import { Topbar } from '../widgets/topbar/topbar';
import { Wishlist } from '../widgets/wishlist/wishlist';

@Component({
  selector: 'app-minimal-header',
  templateUrl: './minimal-header.html',
  styleUrls: ['./minimal-header.scss'],
  imports: [
    Topbar,
    NavbarMenuButton,
    Logo,
    Button,
    Menu,
    Search,
    Wishlist,
    Cart,
    MyAccount,
    TranslateModule,
  ],
})
export class MinimalHeader {
  private platformId = inject<Object>(PLATFORM_ID);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IOption | null>();
  readonly logo = input<string | null>();
  readonly sticky = input<boolean | number>(); // Default false

  public stick: boolean = false;
  public active: boolean = false;

  // @HostListener Decorator
  @HostListener('window:scroll', [])
  onWindowScroll() {
    if (isPlatformBrowser(this.platformId)) {
      let number =
        window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      if (number >= 150 && window.innerWidth > 400) {
        this.stick = true;
      } else {
        this.stick = false;
      }
    }
  }

  toggle(val: boolean) {
    this.active = val;
  }
}
