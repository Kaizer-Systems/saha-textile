import type { MediaFileRow } from '@core/media-library/media-library.gateway';

/** The file-type tile of the approved brief: a colour class and a Remix icon per kind. */
export interface FileKind {
	cls: string;
	icon: string;
}

const KIND: Readonly<Record<string, FileKind>> = {
	image: { cls: 'k-image', icon: 'ri-image-line' },
	pdf: { cls: 'k-pdf', icon: 'ri-file-pdf-2-line' },
	doc: { cls: 'k-doc', icon: 'ri-file-word-2-line' },
	sheet: { cls: 'k-sheet', icon: 'ri-file-excel-2-line' },
	csv: { cls: 'k-sheet', icon: 'ri-file-list-3-line' },
	zip: { cls: 'k-zip', icon: 'ri-file-zip-line' },
	video: { cls: 'k-video', icon: 'ri-film-line' },
	backup: { cls: 'k-backup', icon: 'ri-database-2-line' },
	audio: { cls: 'k-audio', icon: 'ri-music-2-line' },
	ppt: { cls: 'k-pdf', icon: 'ri-file-ppt-2-line' },
	text: { cls: 'k-other', icon: 'ri-file-text-line' },
	raw: { cls: 'k-other', icon: 'ri-camera-lens-line' },
	svg: { cls: 'k-image', icon: 'ri-shape-line' },
	other: { cls: 'k-other', icon: 'ri-file-3-line' },
};

const BY_EXTENSION: Readonly<Record<string, string>> = {
	pdf: 'pdf',
	doc: 'doc',
	docx: 'doc',
	odt: 'doc',
	xls: 'sheet',
	xlsx: 'sheet',
	ods: 'sheet',
	csv: 'csv',
	zip: 'zip',
	rar: 'zip',
	'7z': 'zip',
	gz: 'zip',
	tar: 'zip',
	ppt: 'ppt',
	pptx: 'ppt',
	txt: 'text',
	md: 'text',
	svg: 'svg',
	mp3: 'audio',
	wav: 'audio',
	m4a: 'audio',
	dng: 'raw',
	cr2: 'raw',
	cr3: 'raw',
	nef: 'raw',
	arw: 'raw',
	orf: 'raw',
	rw2: 'raw',
	raf: 'raw',
};

/** The part of a name after the last dot, as the Type column shows it ("PDF", "JPG"). */
export function fileExtension(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
}

/** Which tile a file gets: its category first (images, videos, backups), then its extension. */
export function fileKind(file: Pick<MediaFileRow, 'name' | 'category' | 'kind'>): FileKind {
	if (file.kind === 'image' || file.category === 'images') return KIND['image'] as FileKind;
	if (file.kind === 'video' || file.category === 'videos') return KIND['video'] as FileKind;
	if (file.category === 'backups') return KIND['backup'] as FileKind;
	const kind =
		BY_EXTENSION[fileExtension(file.name).toLowerCase()] ?? (file.category === 'archives' ? 'zip' : 'other');
	return KIND[kind] ?? (KIND['other'] as FileKind);
}

/** The Type column: the name's extension, else the stored format (`image/jpeg` → “JPG”). */
export function fileTypeLabel(file: Pick<MediaFileRow, 'name' | 'contentType'>): string {
	const fromName = fileExtension(file.name);
	if (fromName) return fromName;
	const subtype = (file.contentType.split('/')[1] ?? '').split(/[+;.-]/)[0] ?? '';
	return subtype === 'jpeg' ? 'JPG' : subtype.toUpperCase();
}
