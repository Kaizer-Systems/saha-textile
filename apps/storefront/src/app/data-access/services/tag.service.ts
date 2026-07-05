import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { ITagModel } from '@data-access/interfaces/tag.interface';

@Injectable({
  providedIn: 'root',
})
export class TagService {
  private http = inject(HttpClient);

  getTags(payload?: Params): Observable<ITagModel> {
    return this.http.get<ITagModel>(`${environment.URL}/tag.json`, { params: payload });
  }
}
