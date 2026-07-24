import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IModule, IRoleModel } from '@data-access/interfaces/role.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class RoleService {
	private http = inject(HttpClient);

	getRoleModules(): Observable<IModule[]> {
		return this.http.get<IModule[]>(`${environment.URL}/module.json`);
	}

	getRoles(payload?: Params): Observable<IRoleModel> {
		return this.http.get<IRoleModel>(`${environment.URL}/role.json`, { params: payload });
	}
}
