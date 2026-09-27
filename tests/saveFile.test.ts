import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_URL_LIFETIME, SaveCancelled, pickSaveTarget, saveBlob } from '../src/saveFile';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeHandle(fail = false) {
  const log: string[] = [];
  const handle = {
    createWritable: async () => ({
      write: async (blob: Blob) => {
        if (fail) throw new DOMException('disk full', 'QuotaExceededError');
        log.push(`write ${blob.size}`);
      },
      close: async () => void log.push('close'),
      abort: async () => void log.push('abort'),
    }),
  } as unknown as FileSystemFileHandle;
  return { handle, log };
}

describe('saving a backup file', () => {
  it('uses the save dialog when there is one and reports a confirmed save', async () => {
    const { handle, log } = fakeHandle();
    const picker = vi.fn().mockResolvedValue(handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const target = await pickSaveTarget('compasso-backup-2026-09-26.zip');
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'compasso-backup-2026-09-26.zip' }),
    );
    expect(await saveBlob(new Blob(['zip']), 'x.zip', target)).toBe('file');
    expect(log).toEqual(['write 3', 'close']);
  });

  it('treats a closed dialog as a cancel and a refused one as a plain download', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')));
    await expect(pickSaveTarget('x.zip')).rejects.toBeInstanceOf(SaveCancelled);
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn().mockRejectedValue(new DOMException('no gesture', 'SecurityError')),
    );
    expect(await pickSaveTarget('x.zip')).toBeNull();
    vi.stubGlobal('showSaveFilePicker', undefined);
    expect(await pickSaveTarget('x.zip')).toBeNull();
  });

  it('discards a failed write instead of reporting a saved file', async () => {
    const { handle, log } = fakeHandle(true);
    await expect(saveBlob(new Blob(['zip']), 'x.zip', handle)).rejects.toThrow('local escolhido');
    expect(log).toEqual(['abort']);
  });

  it('falls back to a download whose link outlives a slow answer to the prompt', async () => {
    vi.useFakeTimers();
    const anchor = { click: vi.fn(), remove: vi.fn(), href: '', download: '', rel: '' };
    vi.stubGlobal('document', { createElement: () => anchor, body: { append: vi.fn() } });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
    expect(await saveBlob(new Blob(['zip']), 'compasso.zip', null)).toBe('download');
    expect(anchor).toMatchObject({ href: 'blob:backup', download: 'compasso.zip' });
    expect(anchor.click).toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOWNLOAD_URL_LIFETIME);
    expect(revoke).toHaveBeenCalledWith('blob:backup');
    expect(DOWNLOAD_URL_LIFETIME).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});
