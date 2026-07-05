import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IFaqModel } from '@data-access/interfaces/page.interface';

@Injectable({
  providedIn: 'root',
})
export class PageService {
  private http = inject(HttpClient);

  public skeletonLoader: boolean = false;

  getFaqs(): Observable<IFaqModel> {
    return this.http.get<IFaqModel>(`${environment.URL}/faq.json`);
  }
}
