import { db } from '../db';

export type VideoQuality = '720' | '1080';

/** MP4 first (it plays everywhere; Chrome records it since 2024, Safari always did), then WebM. */
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function videoRecorderOptions(isSupported: (type: string) => boolean, quality: VideoQuality) {
  const mimeType = VIDEO_TYPES.find(isSupported);
  return {
    ...(mimeType ? { mimeType } : {}),
    // About 19 MB a minute at 720p and 38 MB at 1080p: enough for hands on the keys.
    videoBitsPerSecond: quality === '1080' ? 5_000_000 : 2_500_000,
    audioBitsPerSecond: 128_000,
  } satisfies MediaRecorderOptions;
}

export function videoConstraints(deviceId: string, quality: VideoQuality): MediaTrackConstraints {
  const [width, height] = quality === '1080' ? [1920, 1080] : [1280, 720];
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: 30 },
  };
}

export const videoExtension = (mime: string) => (mime.includes('mp4') ? 'mp4' : 'webm');

/** "Compasso - Entrada da mão esquerda - 2026-09-28 14h05.mp4": safe on Windows, macOS and iPadOS. */
export function videoFileName(title: string, mime: string, at = new Date()) {
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}h${two(at.getMinutes())}`;
  const safe = title
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `Compasso - ${safe || 'Prática'} - ${stamp}.${videoExtension(mime)}`;
}

/** The camera could not be opened: what happened and what to do, in Portuguese. */
export function cameraError(error: unknown): string {
  switch ((error as { name?: unknown } | null)?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'O acesso à câmera ou ao microfone não foi permitido. Libere os dois para este site nas configurações do navegador e tente de novo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'A câmera escolhida não foi encontrada. Conecte uma câmera ou escolha outra.';
    case 'NotReadableError':
    case 'AbortError':
      return 'A câmera não pôde ser aberta: outro aplicativo (videochamada, gravador) pode estar usando-a. Feche-o e tente de novo.';
    default:
      return 'Não foi possível abrir a câmera.';
  }
}

// ---------- Saving straight to a folder (File System Access: Chrome and Edge on computers) ----------

type Permissioned = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};
type PickerWindow = Window & {
  showDirectoryPicker?: (o: {
    id?: string;
    mode?: 'readwrite';
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
};

/** Safari, iPadOS and Firefox cannot write into a folder: their videos stay in the app, ready to download. */
export const canPickFolder = () =>
  typeof window !== 'undefined' &&
  typeof (window as PickerWindow).showDirectoryPicker === 'function' &&
  typeof FileSystemFileHandle !== 'undefined' &&
  'createWritable' in FileSystemFileHandle.prototype;

const FOLDER_KEY = 'video-folder';

/** Asks for a folder; null when the student cancels. The choice is remembered on this device. */
export async function pickVideoFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await (window as PickerWindow).showDirectoryPicker!({
      id: 'compasso-videos',
      mode: 'readwrite',
      startIn: 'videos',
    });
    await db.handles.put({ id: FOLDER_KEY, handle, name: handle.name });
    return handle;
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return null;
    throw error;
  }
}

export async function savedVideoFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await db.handles.get(FOLDER_KEY))?.handle ?? null;
  } catch {
    return null;
  }
}

/** Browsers ask again after a restart: call it from the click that starts the recording. */
export async function canWrite(handle: FileSystemDirectoryHandle) {
  const h = handle as Permissioned;
  if (!h.queryPermission || !h.requestPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}
