import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { Sidebar } from './sidebar/sidebar';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { Loader } from '@shared/ui/loader/loader';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { LoaderStore } from '@core/state/loader.store';

@Component({
  selector: 'app-account',
  templateUrl: './account.html',
  styleUrls: ['./account.scss'],
  imports: [Breadcrumb, Sidebar, Loader, Button, RouterOutlet, AsyncPipe, TranslateModule],
})
export class Account {
  private loaderStore = inject(LoaderStore);

  loadingStatus$: Observable<boolean> = toObservable(this.loaderStore.status);

  public open: boolean = false;
  public breadcrumb: IBreadcrumb = {
    title: 'Dashboard',
    items: [{ label: 'Dashboard', active: false }],
  };

  openMenu(value: boolean) {
    this.open = value;
  }
}
