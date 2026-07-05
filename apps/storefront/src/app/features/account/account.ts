import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { Sidebar } from './sidebar/sidebar';
import { GetNotificationAction } from '@data-access/actions/notification.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { Loader } from '@shared/ui/loader/loader';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { LoaderState } from '@data-access/states/loader.state';

@Component({
  selector: 'app-account',
  templateUrl: './account.html',
  styleUrls: ['./account.scss'],
  imports: [Breadcrumb, Sidebar, Loader, Button, RouterOutlet, AsyncPipe, TranslateModule],
})
export class Account {
  private store = inject(Store);

  loadingStatus$: Observable<boolean> = inject(Store).select(
    LoaderState.status,
  ) as Observable<boolean>;

  public open: boolean = false;
  public breadcrumb: IBreadcrumb = {
    title: 'Dashboard',
    items: [{ label: 'Dashboard', active: false }],
  };

  constructor() {
    this.store.dispatch(new GetNotificationAction());
  }

  openMenu(value: boolean) {
    this.open = value;
  }
}
