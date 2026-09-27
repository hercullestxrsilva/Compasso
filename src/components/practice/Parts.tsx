import { RotateCcw, SkipForward } from 'lucide-react';
import {
  clock,
  formatDate,
  type Piece,
  type PracticeConfig,
  type Preset,
  type Rating,
  type Routine,
  type Segment,
} from '../../domain';
import { pieceTarget, plural } from '../../practice/setup';
import type { ReviewSchedule } from '../../practice/review';
import { ratings } from './SessionReview';

/** Presentational pieces of the practice screen. */

export interface RoutineRun {
  routine: Routine;
  /** The step playing now, or the next one while waiting between steps. */
  index: number;
  /** Seconds before the next step starts by itself; null while a step plays or while waiting for a tap. */
  countdown: number | null;
  /** The step just finished, for a one-tap rating. */
  last?: {
    sessionId: string;
    segmentId?: string;
    title: string;
    rating?: Rating;
    /** The trecho's review schedule before the rating (every tap starts from it). */
    schedule?: ReviewSchedule;
    /** Review date set by the rating. */
    reviewDate?: string;
  };
}

export function BeatDots({ count, lit, flashKey }: { count: number; lit: number; flashKey: string }) {
  return (
    <div className="beat-dots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        // A new key on each beat remounts the lit dot, so its flash animation plays again.
        <span
          key={i === lit ? `lit-${flashKey}` : i}
          className={`${i === 0 ? 'accent' : ''} ${i === lit ? 'lit' : ''}`}
        />
      ))}
    </div>
  );
}

export function RoutineStrip({ run }: { run: RoutineRun }) {
  return (
    <div className="routine-strip">
      <div className="routine-strip-head">
        <span className="eyebrow">ROTINA</span>
        <strong className="grow">{run.routine.title}</strong>
        <span className="routine-strip-count">
          Passo {run.index + 1} de {run.routine.items.length}
        </span>
      </div>
      <ol className="routine-progress" aria-hidden="true">
        {run.routine.items.map((_, i) => (
          <li key={i} className={i < run.index ? 'done' : i === run.index ? 'current' : ''} />
        ))}
      </ol>
    </div>
  );
}

/** One-tap rating of the routine step just played (it schedules the trecho's next review). */
export function QuickRating({
  last,
  onRate,
}: {
  last: NonNullable<RoutineRun['last']>;
  onRate: (rating: Rating) => void;
}) {
  return (
    <div className="quick-rating">
      <span>Como foi “{last.title}”?</span>
      <div className="rating-buttons">
        {ratings.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={last.rating === key}
            className={`rating-${key}${last.rating === key ? ' selected' : ''}`}
            onClick={() => onRate(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {last.reviewDate && (
        <p className="quick-review">Próxima revisão deste trecho: {formatDate(last.reviewDate)}</p>
      )}
    </div>
  );
}

/**
 * Between two routine steps: rate the one just played, see what comes next, and a short countdown. Not a live
 * region (the countdown would be read every second); the practice screen announces the next step once.
 */
export function RoutineTransition({
  run,
  nextTitle,
  nextDetail,
  onRate,
  onWait,
  onSkip,
  onEnd,
}: {
  run: RoutineRun;
  nextTitle: string;
  nextDetail: string;
  onRate: (rating: Rating) => void;
  onWait: () => void;
  onSkip: () => void;
  onEnd: () => void;
}) {
  return (
    <section className="routine-transition" aria-label="A seguir na rotina">
      {run.last && <QuickRating last={run.last} onRate={onRate} />}
      <p className="transition-next">
        <span className="eyebrow">PRÓXIMO</span>
        <strong>{nextTitle}</strong>
        {nextDetail && <span>{nextDetail}</span>}
      </p>
      {run.countdown !== null ? (
        <p className="transition-countdown">
          Começa em <strong>{run.countdown}</strong> s
        </p>
      ) : (
        <p className="hint">Toque em começar quando estiver pronto.</p>
      )}
      <div className="row wrap">
        {run.countdown !== null && (
          <button className="btn small secondary" onClick={onWait}>
            Esperar
          </button>
        )}
        <button className="btn small secondary" onClick={onSkip}>
          <SkipForward size={15} />
          Pular este passo
        </button>
        <button className="btn small secondary" onClick={onEnd}>
          Encerrar rotina
        </button>
      </div>
    </section>
  );
}

/** "O que vamos estudar?": free practice, then each piece (whole, or one of its trechos). */
export function TargetOptions({ groups }: { groups: { piece?: Piece; segments: Segment[] }[] }) {
  return (
    <>
      <option value="">Prática livre / metrônomo</option>
      {groups.map(g =>
        g.piece?.warmup ? (
          g.segments.length > 0 && (
            <optgroup key={g.piece.id} label={`Aquecimento · ${g.piece.title}`}>
              {g.segments.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          )
        ) : g.piece ? (
          <optgroup key={g.piece.id} label={g.piece.title}>
            <option value={pieceTarget(g.piece.id)}>Peça inteira: {g.piece.title}</option>
            {g.segments.map(s => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.measures ? ` · c. ${s.measures}` : ''}
              </option>
            ))}
          </optgroup>
        ) : (
          <optgroup key="outros" label="Outros trechos">
            {g.segments.map(s => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </>
  );
}

/** Saved configurations: this trecho's first, then general ones, then other trechos'. */
export function PresetOptions({
  presets,
  segments,
  segmentId,
}: {
  presets: Preset[];
  segments: Segment[];
  segmentId?: string;
}) {
  const byName = (list: Preset[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const groups = [
    ['Deste trecho', byName(presets.filter(p => segmentId && p.segmentId === segmentId))],
    ['Gerais', byName(presets.filter(p => !p.segmentId))],
    ['Outros trechos', byName(presets.filter(p => p.segmentId && p.segmentId !== segmentId))],
  ] as const;
  return (
    <>
      <option value="">Carregar uma configuração…</option>
      {groups.map(
        ([label, list]) =>
          list.length > 0 && (
            <optgroup key={label} label={label}>
              {list.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {label === 'Outros trechos'
                    ? ` (${segments.find(s => s.id === p.segmentId)?.title ?? 'trecho removido'})`
                    : ''}
                </option>
              ))}
            </optgroup>
          ),
      )}
    </>
  );
}

/** Chips that summarise the cycle under the metronome. */
export function CycleSummary({ config }: { config: PracticeConfig }) {
  return (
    <div className="practice-summary">
      {config.metronome === false ? (
        <>
          <span>Só cronômetro</span>
          <span>
            {config.loop
              ? 'Contínuo, sem fim'
              : `${plural(config.repetitions, 'bloco', 'blocos')} de ${clock(config.seconds)}`}
          </span>
        </>
      ) : (
        <>
          <span>
            {config.numerator}/{config.denominator}
          </span>
          <span>
            {config.loop
              ? 'Contínuo, sem fim'
              : `${config.mode === 'bars' ? plural(config.bars, 'compasso', 'compassos') : `${config.seconds} segundos`} × ${config.repetitions}`}
          </span>
          <span>
            {config.countInBars
              ? `${plural(config.countInBars, 'compasso', 'compassos')} de preparação`
              : 'Sem preparação'}
          </span>
          {config.increaseEvery > 0 && !config.loop && (
            <span>
              +{config.increaseBpm} BPM a cada{' '}
              {config.increaseEvery === 1 ? 'repetição' : `${config.increaseEvery} repetições`}
            </span>
          )}
          {config.silentBars > 0 && (
            <span>
              {config.audibleBars} com clique, {config.silentBars} em silêncio
            </span>
          )}
        </>
      )}
      {config.repetitions > 1 && (
        <span>{config.restSeconds ? `${config.restSeconds} s de pausa` : 'Sem pausa'}</span>
      )}
    </div>
  );
}

export function PracticeTips() {
  return (
    <aside className="practice-tips">
      <span className="eyebrow">UM PLANO SIMPLES</span>
      <h2>
        Menos pressa.
        <br />
        Mais atenção.
      </h2>
      <ol>
        <li>
          <strong>Escolha um objetivo</strong>
          <p>Um trecho, uma mão, uma dificuldade por vez.</p>
        </li>
        <li>
          <strong>Comece confortável</strong>
          <p>Use um andamento que permita ouvir o que está tocando.</p>
        </li>
        <li>
          <strong>Observe ao terminar</strong>
          <p>Registre o que melhorou e o que quer rever.</p>
        </li>
      </ol>
      <div className="tip-note">
        <RotateCcw size={21} />
        <p>O ciclo marca o tempo. Você e seu professor avaliam a música.</p>
      </div>
    </aside>
  );
}
