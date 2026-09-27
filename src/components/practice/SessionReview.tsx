import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { formatDate, localDay, type Rating, type Segment } from '../../domain';
import { currentInterval, daysBetween, nextReviewDate } from '../../practice/review';
import { plural } from '../../practice/setup';
import { Modal, Field, errorText, useConfirm, type Notify } from '../common';

export const ratings = [
  ['difficult', 'Difícil'],
  ['improving', 'Melhorando'],
  ['comfortable', 'Confortável'],
] as const;

export interface ReviewInfo {
  sessionId: string;
  title: string;
  segmentId?: string;
  intention?: string;
  /** Highest tempo really played in the session. */
  maxBpm?: number;
  completed: boolean;
  /** Set when this session closed a routine. */
  routineTitle?: string;
}

/** The segment and the interval of the review it has now (measured from the previous session). */
async function reviewContext(segmentId: string | undefined, sessionId: string) {
  const segment = segmentId ? await db.segments.get(segmentId) : undefined;
  if (!segment) return { segment: undefined, interval: undefined };
  const sessions = await db.sessions.where('segmentId').equals(segment.id).reverse().sortBy('startedAt');
  const previous = sessions.find(s => s.id !== sessionId);
  return {
    segment,
    interval: currentInterval(segment.reviewDate, previous && localDay(new Date(previous.startedAt))),
  };
}

/** One-tap rating (between routine steps): also schedules the segment's next review. */
export async function quickRate(sessionId: string, segmentId: string | undefined, rating: Rating) {
  const { segment, interval } = await reviewContext(segmentId, sessionId);
  await db.transaction('rw', [db.sessions, db.segments], async () => {
    await db.sessions.update(sessionId, { rating });
    if (segment)
      await db.segments.update(segment.id, {
        rating,
        reviewDate: nextReviewDate(rating, localDay(), interval),
      });
  });
}

/** "Como foi a prática?" — nothing is preselected; the session itself is already saved. */
export default function SessionReview({
  info,
  notify,
  onDone,
}: {
  info: ReviewInfo;
  notify: Notify;
  /** Called when the modal closes; 
aisedBpm when the segment's BPM was updated. */
  onDone: (raisedBpm?: number) => void;
}) {
  const confirm = useConfirm();
  const context = useLiveQuery(
    () => reviewContext(info.segmentId, info.sessionId),
    [info.segmentId, info.sessionId],
  );
  const segment: Segment | undefined = context?.segment;
  const [rating, setRating] = useState<Rating>(),
    [note, setNote] = useState(''),
    [nextStep, setNextStep] = useState(''),
    [reviewDate, setReviewDate] = useState<string | null>(null),
    [raiseBpm, setRaiseBpm] = useState(false),
    [saving, setSaving] = useState(false);
  const today = localDay();
  const suggested = rating && segment ? nextReviewDate(rating, today, context?.interval) : '';
  const review = reviewDate ?? suggested;
  const offerBpm = segment && info.maxBpm && info.maxBpm > segment.bpm ? info.maxBpm : undefined;
  const dirty = Boolean(rating || note.trim() || nextStep.trim() || raiseBpm);
  const leave = async () => {
    if (
      dirty &&
      !(await confirm({
        title: 'Descartar esta reflexão?',
        message:
          'A sessão continua salva no histórico. Só o que você marcou e escreveu agora será descartado.',
        confirmLabel: 'Descartar',
        danger: true,
      }))
    )
      return;
    onDone();
  };
  const save = async () => {
    setSaving(true);
    try {
      await db.transaction('rw', [db.sessions, db.segments], async () => {
        await db.sessions.update(info.sessionId, {
          rating,
          note: note.trim(),
          nextStep: nextStep.trim() || undefined,
        });
        if (segment) {
          const patch: Partial<Segment> = {};
          if (rating) Object.assign(patch, { rating, reviewDate: review });
          if (raiseBpm && offerBpm) patch.bpm = offerBpm;
          if (Object.keys(patch).length) await db.segments.update(segment.id, patch);
        }
      });
      notify(
        rating && segment && review
          ? `Reflexão salva. Próxima revisão em ${formatDate(review)}`
          : 'Reflexão salva no histórico.',
      );
      onDone(raiseBpm ? offerBpm : undefined);
    } catch (e) {
      notify(`Não foi possível salvar a reflexão: ${errorText(e)}`, 'error');
    } finally {
      setSaving(false);
    }
  };
  const days = suggested ? daysBetween(today, suggested) : 0;
  return (
    <Modal title={info.routineTitle ? 'Rotina concluída' : 'Como foi a prática?'} onClose={leave} guard>
      <p className="hint">
        {info.routineTitle && <>Você terminou a rotina “{info.routineTitle}”. </>}
        {info.completed ? 'A sessão já está salva.' : 'A sessão foi salva como parcial.'} Uma reflexão curta
        ajuda a decidir o próximo estudo de “{info.title}”.
      </p>
      {info.intention && (
        <p className="review-intention">
          <span className="eyebrow">SUA INTENÇÃO</span>
          <span>“{info.intention}”</span>
        </p>
      )}
      <fieldset className="review-rating">
        <legend>Como foi?</legend>
        <div className="rating-buttons">
          {ratings.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={rating === key}
              className={rating === key ? 'selected' : ''}
              onClick={() => setRating(rating === key ? undefined : key)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="O que você percebeu?">
        <textarea
          rows={3}
          value={note}
          maxLength={3000}
          onChange={e => setNote(e.target.value)}
          placeholder="Ex.: a passagem ficou mais regular hoje."
        />
      </Field>
      <Field label="Próximo passo" hint="Na próxima vez, aparece como sugestão de intenção.">
        <input
          value={nextStep}
          maxLength={300}
          onChange={e => setNextStep(e.target.value)}
          placeholder="Ex.: mão esquerda sozinha, mais leve no polegar."
        />
      </Field>
      {segment && rating && (
        <Field
          label="Próxima revisão deste trecho"
          hint={
            reviewDate === null
              ? `Sugerida para daqui a ${plural(days, 'dia', 'dias')}. Você pode mudar.`
              : 'Deixe em branco para não agendar.'
          }
        >
          <input type="date" value={review} min={today} onChange={e => setReviewDate(e.target.value)} />
        </Field>
      )}
      {offerBpm && (
        <label className="check-row">
          <input type="checkbox" checked={raiseBpm} onChange={e => setRaiseBpm(e.target.checked)} />
          <span>
            Atualizar o BPM do trecho para {offerBpm} <small>(hoje: {segment?.bpm})</small>
          </span>
        </label>
      )}
      <footer className="modal-actions">
        <button type="button" className="btn secondary" onClick={() => void leave()}>
          Pular
        </button>
        <button type="button" className="btn" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </footer>
    </Modal>
  );
}
