import { isPlatformBrowser } from '@angular/common';
import { Component, HostListener, PLATFORM_ID, inject, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IOption } from '@data-access/interfaces/theme-option.interface';
import { Button } from '@shared/ui/button/button';
import { Menu } from '@shared/ui/menu/menu';
import { Call } from '../widgets/call/call';
import { Cart } from '../widgets/cart/cart';
import { Compare } from '../widgets/compare/compare';
import { Logo } from '../widgets/logo/logo';
import { MyAccount } from '../widgets/my-account/my-account';
import { NavbarMenuButton } from '../widgets/navbar-menu-button/navbar-menu-button';
import { Search } from '../widgets/search/search';
import { SearchBox } from '../widgets/search-box/search-box';
import { Wishlist } from '../widgets/wishlist/wishlist';

@Component({
  selector: 'app-classic-header',
  templateUrl: './classic-header.html',
  styleUrls: ['./classic-header.scss'],
  imports: [
    NavbarMenuButton,
    Logo,
    Search,
    Call,
    Button,
    Menu,
    SearchBox,
    Compare,
    Wishlist,
    Cart,
    MyAccount,
    TranslateModule,
  ],
})
export class ClassicHeader {
  private platformId = inject<Object>(PLATFORM_ID);

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
