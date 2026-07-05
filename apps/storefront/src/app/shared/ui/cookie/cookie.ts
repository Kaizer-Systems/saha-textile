import { Component, inject } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { UpdateSessionAction } from '@data-access/actions/theme-option.action';
import { ThemeOptionState } from '@data-access/states/theme-option.state';

@Component({
  selector: 'app-cookie',
  templateUrl: './cookie.html',
  styleUrls: ['./cookie.scss'],
  imports: [TranslateModule],
})
export class Cookie {
  private store = inject(Store);

  cookies$: Observable<boolean> = inject(Store).select(ThemeOptionState.cookies);

  public cookies: boolean = true;

  constructor() {
    this.cookies$.subscribe(res => (this.cookies = res));
  }

  acceptCookies(value: boolean) {
    this.store.dispatch(new UpdateSessionAction('cookies', value));
  }
}
