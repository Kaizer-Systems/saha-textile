import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { ISetting } from '@data-access/interfaces/setting.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class SettingService {
	private http = inject(HttpClient);

	getSettingOption(): Observable<ISetting> {
		return this.http.get<ISetting>(`${environment.URL}/setting.json`);
	}

	getBackendSettingOption(): Observable<ISetting> {
		return this.http.get<ISetting>(`${environment.URL}/setting.json`);
	}
}
