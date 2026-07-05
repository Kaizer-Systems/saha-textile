import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private http = inject(HttpClient);

  getHomePage(slug?: string): Observable<object | null> {
    if (!slug) {
      slug = 'paris';
    }
    return this.http.get<object | null>(`${environment.URL}/themes/${slug}.json`);
  }
}
