import { Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/** The browser's own barcode reader, where the phone has one (Chrome on Android; not every browser). */
interface DetectedCode {
	rawValue: string;
}
interface BarcodeReader {
	detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}
type BarcodeReaderClass = new (options: { formats: string[] }) => BarcodeReader;

export const cameraScanAvailable = (): boolean =>
	typeof window !== 'undefined' &&
	'BarcodeDetector' in window &&
	!!navigator.mediaDevices &&
	typeof navigator.mediaDevices.getUserMedia === 'function';

/**
 * Scan a label (g01, g02, l01): the phone's camera reads a Code 128 label where the browser can
 * read barcodes; a typed SKU always works, and a handheld scanner types into the same box.
 */
@Component({
	selector: 'app-scan-popup',
	templateUrl: './scan-popup.html',
	imports: [TranslocoModule],
})
export class ScanPopup implements OnDestroy {
	readonly modal = inject(NgbActiveModal);
	private readonly video = viewChild<ElementRef<HTMLVideoElement>>('scanVideo');

	readonly camera = signal(cameraScanAvailable());
	readonly cameraError = signal(false);
	readonly typed = signal('');
	private stream: MediaStream | null = null;
	private stopped = false;

	async startCamera(): Promise<void> {
		if (!this.camera()) return;
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
			const video = this.video()?.nativeElement;
			if (!video) return;
			video.srcObject = this.stream;
			await video.play();
			const Reader = (window as unknown as { BarcodeDetector: BarcodeReaderClass }).BarcodeDetector;
			const reader = new Reader({ formats: ['code_128', 'ean_13', 'qr_code'] });
			const look = async () => {
				if (this.stopped) return;
				try {
					const [code] = await reader.detect(video);
					if (code?.rawValue) {
						this.done(code.rawValue);
						return;
					}
				} catch {
					// A frame that can't be read is skipped.
				}
				setTimeout(() => void look(), 250);
			};
			void look();
		} catch {
			// Camera refused or busy: the typed box still works.
			this.cameraError.set(true);
			this.camera.set(false);
		}
	}

	done(code: string): void {
		const value = code.trim();
		if (!value) return;
		this.stop();
		this.modal.close(value);
	}

	private stop(): void {
		this.stopped = true;
		for (const track of this.stream?.getTracks() ?? []) track.stop();
		this.stream = null;
	}

	ngOnDestroy(): void {
		this.stop();
	}
}
