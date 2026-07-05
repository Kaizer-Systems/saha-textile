import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { SettingStore } from '@core/state/setting.store';
import { IValues } from '@data-access/interfaces/setting.interface';

@Component({
	selector: 'app-footer',
	templateUrl: './footer.html',
	styleUrls: ['./footer.scss'],
	imports: [AsyncPipe],
})
export class Footer {
	setting$: Observable<IValues | null> = toObservable(inject(SettingStore).setting);
}
