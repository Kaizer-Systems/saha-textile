import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { SettingStore } from '@core/state/setting.store';
import { IValues } from '@data-access/interfaces/setting.interface';

@Component({
	selector: 'app-maintenance',
	templateUrl: './maintenance.html',
	styleUrls: ['./maintenance.scss'],
	imports: [AsyncPipe, TranslocoModule],
})
export class Maintenance {
	private settingStore = inject(SettingStore);

	// Background image stays settings-driven (an asset, not translatable copy). The
	// maintenance-mode flag is read separately by the auth interceptor. Only the
	// visible title/description text moved to Machine-1 (Transloco keys).
	setting$: Observable<IValues> = toObservable(this.settingStore.setting) as Observable<IValues>;

	constructor() {
		this.settingStore.loadSettings();
	}
}
