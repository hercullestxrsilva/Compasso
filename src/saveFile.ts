/** A file the student picked in the browser's save dialog, or null for a plain download. */
export type SaveTarget = FileSystemFileHandle | null;
/** 'file': written and closed, so it is really on disk. 'download': handed to the browser, which may still ask. */
export type SaveResult = 'file' | 'download';

/** The student closed the save dialog; nothing was written. */
export class SaveCancelled extends Error {
  constructor() {
    super('Exportação cancelada.');
    this.name = 'SaveCancelled';
  }
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/**
 * Opens the save dialog where the browser has one (Chrome and Edge on desktop). Call it before any slow work:
 * it needs the tap that started the export. Returns null without a dialog (Safari, Firefox) or when the
 * browser refuses to show it; throws SaveCancelled when the student closes it.
 */
export async function pickSaveTarget(name: string): Promise<SaveTarget> {
  const picker = (globalThis as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof picker !== 'function') return null;
  try {
    return await picker({
      suggestedName: name,
      types: [{ description: 'Backup do Compasso', accept: { 'application/zip': ['.zip'] } }],
    });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw new SaveCancelled();
    // Expired user activation or a blocked dialog: fall back to a regular download.
    return null;
  }
}

/** How long a download link stays valid: Safari on iPad asks first and reads the file only after the answer. */
export const DOWNLOAD_URL_LIFETIME = 5 * 60 * 1000;

/** Writes the blob to the picked file, or starts a download when there is none. */
export async function saveBlob(blob: Blob, name: string, target: SaveTarget): Promise<SaveResult> {
  if (target) {
    const writable = await target.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (e) {
      // abort() discards the partial write; a file chosen to be replaced keeps its previous content.
      await writable.abort().catch(() => {});
      throw new Error(
        'Não foi possível gravar o backup no local escolhido. Confira o espaço livre no disco e tente de novo.',
        { cause: e },
      );
    }
    return 'file';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME);
  return 'download';
}
