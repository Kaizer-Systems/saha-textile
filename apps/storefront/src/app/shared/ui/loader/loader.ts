import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-loader',
  templateUrl: './loader.html',
  styleUrls: ['./loader.scss'],
  imports: [TranslateModule],
})
export class Loader {
  readonly loaderClass = input<string>('loader-wrapper');
}
