import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloud = url && key ? createClient(url, key) : null;
/** An AI request failure with the HTTP status (0 when no response) and, for 429, the seconds to wait. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
    readonly cancelled = false,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
function anySignal(signals: AbortSignal[]) {
  if ('any' in AbortSignal) return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
/** Calls the app's AI endpoints. Pass `signal` to let the student cancel a long request. */
export async function aiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (cloud) {
    const { data } = await cloud.auth.getSession();
    if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  const timeout = AbortSignal.timeout(240000);
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      signal: options.signal ? anySignal([options.signal, timeout]) : timeout,
    });
  } catch {
    if (options.signal?.aborted) throw new AiError('Operação cancelada.', 0, undefined, true);
    throw new AiError(
      timeout.aborted
        ? 'O serviço de IA demorou demais para responder. Tente novamente.'
        : 'Não foi possível acessar o serviço de IA. Confira a conexão e a configuração do servidor.',
      0,
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json'))
    throw new AiError(
      response.status === 413
        ? 'O áudio excede o limite aceito pelo servidor. Importe um trecho menor ou cole a transcrição.'
        : 'O serviço de IA ainda não está disponível. Configure o servidor para ativar este recurso.',
      response.status,
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AiError('O serviço de IA respondeu de forma inesperada. Tente novamente.', response.status);
  }
  if (!response.ok) {
    const wait = Number(response.headers.get('retry-after'));
    throw new AiError(
      data?.error ?? 'O serviço de IA não conseguiu concluir a solicitação.',
      response.status,
      Number.isFinite(wait) && wait > 0 ? wait : undefined,
    );
  }
  return data;
}
