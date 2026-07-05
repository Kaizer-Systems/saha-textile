import { AsyncPipe, Location } from '@angular/common';
import { Component, inject } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionState } from '@data-access/states/theme-option.state';

@Component({
  selector: 'app-error404',
  templateUrl: './error404.html',
  styleUrls: ['./error404.scss'],
  imports: [Breadcrumb, Button, AsyncPipe],
})
export class Error404 {
  private location = inject(Location);

  themeOption$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;

  public breadcrumb: IBreadcrumb = {
    title: '404',
    items: [{ label: '404', active: true }],
  };

  back() {
    this.location.back();
  }
}
