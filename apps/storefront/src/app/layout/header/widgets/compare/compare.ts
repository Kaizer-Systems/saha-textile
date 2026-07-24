import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { CompareState } from '@data-access/states/compare.state';

@Component({
  selector: 'app-header-compare',
  templateUrl: './compare.html',
  styleUrls: ['./compare.scss'],
  imports: [RouterLink, AsyncPipe],
})
export class Compare {
  compareTotal$: Observable<number> = inject(Store).select(CompareState.compareTotal);
}
