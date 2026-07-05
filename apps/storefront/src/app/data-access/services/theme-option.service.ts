import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IThemeOption } from '@data-access/interfaces/theme-option.interface';

@Injectable({
  providedIn: 'root',
})
export class ThemeOptionService {
  private http = inject(HttpClient);

  public preloader: boolean = true;
  public theme_color: string;

  getThemeOption(): Observable<IThemeOption> {
    return this.http.get<IThemeOption>(`${environment.URL}/theme-option.json`);
  }
}
