import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { IThemeOption } from '@data-access/interfaces/theme-option.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class ThemeOptionService {
	private http = inject(HttpClient);

	getThemeOption(): Observable<IThemeOption> {
		return this.http.get<IThemeOption>(`${environment.URL}/theme-option.json`);
	}
}
