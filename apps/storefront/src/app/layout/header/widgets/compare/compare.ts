import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CompareFacade } from '@core/state/compare/compare.store';

@Component({
  selector: 'app-header-compare',
  templateUrl: './compare.html',
  styleUrls: ['./compare.scss'],
  imports: [RouterLink, AsyncPipe],
})
export class Compare {
  compareTotal$ = inject(CompareFacade).compareTotal$;
}
