import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

@Component({
	selector: 'app-loader',
	templateUrl: './loader.html',
	styleUrls: ['./loader.scss'],
	imports: [TranslocoModule],
})
export class Loader {
	readonly loaderClass = input<string>('loader-wrapper');
}
