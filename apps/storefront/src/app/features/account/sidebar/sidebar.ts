import { AsyncPipe } from '@angular/common';
import { Component, computed, inject, viewChild, output, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLinkActive, RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { LogoutAction } from '@data-access/actions/auth.action';
import { Button } from '@shared/ui/button/button';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';
import { injectNotificationsQuery } from '@data-access/queries/notification.queries';
import { INotification } from '@data-access/interfaces/notification.interface';
import { IUser } from '@data-access/interfaces/user.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { AccountState } from '@data-access/states/account.state';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
  imports: [
    Button,
    RouterLinkActive,
    RouterLink,
    ConfirmationModal,
    AsyncPipe,
    TitleCasePipe,
    TranslateModule,
  ],
})
export class Sidebar {
  private store = inject(Store);

  readonly show = input<boolean>();
  readonly menu = output<boolean>();

  private readonly notificationsQuery = injectNotificationsQuery();
  notification$: Observable<INotification[]> = toObservable(
    computed(() => this.notificationsQuery.data() ?? []),
  );
  user$: Observable<IUser> = inject(Store).select(AccountState.user) as Observable<IUser>;

  readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

  public unreadNotificationCount: number;

  constructor() {
    this.notification$.subscribe(notification => {
      this.unreadNotificationCount = notification?.filter(item => !item.read_at).length;
    });
  }

  logout() {
    this.store.dispatch(new LogoutAction());
  }

  openMenu(value: boolean) {
    this.menu.emit(value);
  }
}
