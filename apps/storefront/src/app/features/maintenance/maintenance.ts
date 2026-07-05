import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetSettingOptionAction } from '@data-access/actions/setting.action';
import { IValues } from '@data-access/interfaces/setting.interface';
import { SettingState } from '@data-access/states/setting.state';

@Component({
  selector: 'app-maintenance',
  templateUrl: './maintenance.html',
  styleUrls: ['./maintenance.scss'],
  imports: [AsyncPipe],
})
export class Maintenance {
  private store = inject(Store);

  setting$: Observable<IValues> = inject(Store).select(SettingState.setting) as Observable<IValues>;

  constructor() {
    this.store.dispatch(new GetSettingOptionAction());
  }
}
