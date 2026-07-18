import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IBadges } from '@data-access/interfaces/menu.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class NavService {
	private http = inject(HttpClient);

	// Search Box
	public search: boolean = false;

	public collapseSidebar: boolean = false;
	public sidebarLoading: boolean = false;

	getBadges(payload?: Params): Observable<IBadges> {
		return this.http.get<IBadges>(`${environment.URL}/badge.json`, payload);
	}
}
