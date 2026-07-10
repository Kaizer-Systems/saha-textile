import { AsyncPipe, isPlatformBrowser, UpperCasePipe } from '@angular/common';
import { Component, inject, PLATFORM_ID, TemplateRef, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { IOrder } from '@data-access/interfaces/order.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { SettingState } from '@data-access/states/setting.state';
import { Button } from '../../button/button';

@Component({
  selector: 'app-pay-modal',
  templateUrl: './pay-modal.html',
  styleUrls: ['./pay-modal.scss'],
  imports: [Button, ReactiveFormsModule, AsyncPipe, UpperCasePipe, TranslateModule],
})
export class PayModal {
  private modalService = inject(NgbModal);
  private platformId = inject<Object>(PLATFORM_ID);
  private store = inject(Store);

  readonly PayModal = viewChild<TemplateRef<string>>('payModal');
  setting$: Observable<IValues> = inject(Store).select(SettingState.setting) as Observable<IValues>;

  public closeResult: string;
  public modalOpen: boolean = false;
  public order: IOrder;
  public paymentType = new FormControl('', [Validators.required]);

  async openModal(order: IOrder) {
    if (isPlatformBrowser(this.platformId)) {
      this.order = order;
      this.modalOpen = true;
      this.modalService
        .open(this.PayModal(), {
          ariaLabelledBy: 'profile-Modal',
          centered: true,
          windowClass: 'theme-modal pay-modal',
        })
        .result.then(
          result => {
            `Result ${result}`;
          },
          reason => {
            this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
          },
        );
    }
  }

  private getDismissReason(reason: ModalDismissReasons): string {
    if (reason === ModalDismissReasons.ESC) {
      return 'by pressing ESC';
    } else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
      return 'by clicking on a backdrop';
    } else {
      return `with: ${reason}`;
    }
  }

  submit() {
    this.paymentType.markAllAsTouched();
    if (this.paymentType.valid) {
      // Re-payment has no backend yet — was RePaymentAction (no-op mock).
      this.modalService.dismissAll();
    }
  }
}
