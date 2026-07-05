import { Component, SimpleChanges, output, input } from '@angular/core';

import { Button } from '@shared/ui/button/button';

@Component({
  selector: 'app-navbar-menu-button',
  templateUrl: './navbar-menu-button.html',
  styleUrls: ['./navbar-menu-button.scss'],
  imports: [Button],
})
export class NavbarMenuButton {
  readonly activeMenu = output<boolean>();
  readonly show = input<boolean>();

  public active: boolean = false;

  ngOnChanges(changes: SimpleChanges) {
    this.active = changes['show']?.currentValue;
  }

  toggleMenu() {
    this.active = !this.active;
    this.activeMenu.emit(this.active);
  }
}
