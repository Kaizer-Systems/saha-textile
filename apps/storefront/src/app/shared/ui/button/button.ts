import { AsyncPipe, NgClass } from '@angular/common';
import { Component, inject, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { LoaderState } from '@data-access/states/loader.state';

@Component({
  selector: 'app-button',
  imports: [NgClass, AsyncPipe],
  templateUrl: './button.html',
  styleUrls: ['./button.scss'],
})
export class Button {
  readonly class = input<string>('btn btn-animation w-100 justify-content-center');
  readonly iconClass = input<string | null>();
  readonly id = input<string>();
  readonly label = input<string>();
  readonly type = input<string>('submit');
  readonly spinner = input<boolean>(true);
  readonly disabled = input<boolean>(false);

  public buttonId: string | null;

  spinnerStatus$: Observable<boolean> = inject(Store).select(
    LoaderState.buttonSpinner,
  ) as Observable<boolean>;

  constructor() {
    this.spinnerStatus$.subscribe(res => {
      if (res == false) {
        this.buttonId = null;
      }
    });
  }

  public onClick(id: string) {
    this.buttonId = id;
  }
}
