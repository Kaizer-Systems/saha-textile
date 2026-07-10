import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild } from '@angular/core';
import {
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Select2Data, Select2Module } from 'ng-select2-component';

import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '../../button/button';

@Component({
  selector: 'app-refund-modal',
  templateUrl: './refund-modal.html',
  styleUrls: ['./refund-modal.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    Button,
    ReactiveFormsModule,
    FormsModule,
    Select2Module,
    TranslateModule,
    CurrencySymbolPipe,
  ],
})
export class RefundModal {
  private modalService = inject(NgbModal);
  private platformId = inject<Object>(PLATFORM_ID);

  readonly RefundModal = viewChild<TemplateRef<string>>('refundModal');

  public closeResult: string;
  public modalOpen: boolean = false;
  public product: IProduct;
  public form: FormGroup;
  public isBrowser: boolean;

  public option: Select2Data = [
    {
      label: 'Wallet',
      value: 'wallet',
    },
    {
      label: 'Paypal',
      value: 'paypal',
    },
  ];

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.form = new FormGroup({
      reason: new FormControl('', [Validators.required]),
      payment_type: new FormControl('', [Validators.required]),
      product_id: new FormControl(),
    });
  }

  async openModal(product: IProduct) {
    if (isPlatformBrowser(this.platformId)) {
      this.product = product;
      this.form.get('product_id')?.patchValue(product.id);
      this.modalOpen = true;
      this.modalService
        .open(this.RefundModal(), {
          ariaLabelledBy: 'profile-Modal',
          centered: true,
          windowClass: 'theme-modal',
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

  sendRequest() {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      // Refund request has no backend yet — was SendRefundRequestAction (no-op mock).
      this.form.reset();
      this.modalService.dismissAll();
    }
  }
}
