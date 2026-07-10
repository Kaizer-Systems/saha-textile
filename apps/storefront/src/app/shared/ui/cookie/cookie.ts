import { Component, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { ThemeOptionStore } from '@core/state/theme-option.store';

@Component({
  selector: 'app-cookie',
  templateUrl: './cookie.html',
  styleUrls: ['./cookie.scss'],
  imports: [TranslateModule],
})
export class Cookie {
  private themeOptionStore = inject(ThemeOptionStore);

  cookies$: Observable<boolean> = toObservable(this.themeOptionStore.cookies);

  public cookies: boolean = true;

  constructor() {
    this.cookies$.subscribe(res => (this.cookies = res));
  }

  acceptCookies(value: boolean) {
    this.themeOptionStore.updateSession('cookies', value);
  }
}
