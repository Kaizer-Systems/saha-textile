import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IAttributeModel } from '@data-access/interfaces/attribute.interface';
import { Params } from '@data-access/interfaces/core.interface';

@Injectable({
  providedIn: 'root',
})
export class AttributeService {
  private http = inject(HttpClient);

  public skeletonLoader: boolean = false;
  public offCanvasMenu: boolean = false;

  getAttributes(payload?: Params): Observable<IAttributeModel> {
    return this.http.get<IAttributeModel>(`${environment.URL}/attribute.json`, { params: payload });
  }
}
