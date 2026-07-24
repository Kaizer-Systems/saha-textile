import { Component, input } from '@angular/core';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';

import { INewsLetter } from '@data-access/interfaces/theme.interface';
import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-newsletter',
	templateUrl: './newsletter.html',
	styleUrls: ['./newsletter.scss'],
	imports: [ReactiveFormsModule, FormsModule, Button, TranslocoModule],
})
export class Newsletter {
	readonly data = input<INewsLetter | null>();
	readonly style = input<string>('basic');
}
