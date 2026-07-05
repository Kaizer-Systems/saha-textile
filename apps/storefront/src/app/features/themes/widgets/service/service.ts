import { Component, input } from '@angular/core';

import { IIServices } from '@data-access/interfaces/theme.interface';

@Component({
  selector: 'app-service',
  templateUrl: './service.html',
  styleUrls: ['./service.scss'],
  imports: [],
})
export class Service {
  readonly data = input<IIServices[]>();
}
