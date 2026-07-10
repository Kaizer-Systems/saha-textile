import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { IValues } from '@data-access/interfaces/setting.interface';
import { SettingStore } from '@core/state/setting.store';

@Component({
  selector: 'app-maintenance',
  templateUrl: './maintenance.html',
  styleUrls: ['./maintenance.scss'],
  imports: [AsyncPipe],
})
export class Maintenance {
  private settingStore = inject(SettingStore);

  setting$: Observable<IValues> = toObservable(this.settingStore.setting) as Observable<IValues>;

  constructor() {
    this.settingStore.loadSettings();
  }
}
