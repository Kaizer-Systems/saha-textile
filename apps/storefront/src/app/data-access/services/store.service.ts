import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IStoresModel } from '@data-access/interfaces/store.interface';

@Injectable({
  providedIn: 'root',
})
export class StoreService {
  private http = inject(HttpClient);

  public skeletonLoader: boolean = false;

  getStores(payload?: Params): Observable<IStoresModel> {
    return this.http.get<IStoresModel>(`${environment.URL}/store.json`, { params: payload });
  }
}
