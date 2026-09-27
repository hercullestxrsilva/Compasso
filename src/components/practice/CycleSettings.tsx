import { useState } from 'react';
import { clock, configSchema, type PracticeConfig } from '../../domain';
import { activeSeconds, buildTimeline } from '../../practice/timeline';
import { Modal, Field, ErrorBox } from '../common';
import NumberField from './NumberField';

/** "Seu ciclo de prática": edits a copy of the config; nothing changes until "Aplicar". */
export default function CycleSettings({
  config,
  resumeWithCountIn,
  onApply,
  onClose,
}: {
  config: PracticeConfig;
  resumeWithCountIn: boolean;
  onApply: (config: PracticeConfig, resumeWithCountIn: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config),
    [resume, setResume] = useState(resumeWithCountIn),
    [error, setError] = useState('');
  const set = <K extends keyof PracticeConfig>(key: K, value: PracticeConfig[K]) =>
    setDraft(c => ({ ...c, [key]: value }));
  const timer = draft.metronome === false;
  const loop = draft.loop === true;
  const rounds = buildTimeline(draft),
    total = rounds.at(-1)!.end;
  return (
    <Modal title="Seu ciclo de prática" onClose={onClose} wide guard>
      <div className="cycle-settings">
        {timer ? (
          <p className="hint cycle-note">
            Só cronômetro: sem cliques. Para escolher andamento, compasso e preparação, ative o metrônomo no
            console.
          </p>
        ) : (
          <fieldset>
            <legend className="eyebrow">ANDAMENTO E COMPASSO</legend>
            <p className="hint">
              O BPM conta a unidade escolhida. Em 6/8, a semínima pontuada conta em dois.
            </p>
            <div className="form-grid three">
              <NumberField
                label="BPM inicial"
                value={draft.bpm}
                min={20}
                max={300}
                onChange={v => set('bpm', v)}
              />
              <NumberField
                label="Tempos no compasso"
                value={draft.numerator}
                min={1}
                max={12}
                hint="O número de cima."
                onChange={v => set('numerator', v)}
              />
              <Field label="Figura do tempo" hint="O número de baixo.">
                <select value={draft.denominator} onChange={e => set('denominator', Number(e.target.value))}>
                  {[2, 4, 8, 16].map(n => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </Field>
              <Field label="Unidade do BPM">
                <select
                  value={draft.beatUnit}
                  onChange={e => set('beatUnit', e.target.value as PracticeConfig['beatUnit'])}
                >
                  <option value="quarter">Semínima</option>
                  <option value="dotted-quarter">Semínima pontuada</option>
                  <option value="eighth">Colcheia</option>
                </select>
              </Field>
              <Field label="Cliques por tempo" hint="Subdivisões mais suaves.">
                <select value={draft.subdivision} onChange={e => set('subdivision', Number(e.target.value))}>
                  <option value={1}>Só o tempo</option>
                  <option value={2}>2 por tempo</option>
                  <option value={3}>3 por tempo</option>
                  <option value={4}>4 por tempo</option>
                </select>
              </Field>
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend className="eyebrow">DURAÇÃO</legend>
          <p className="hint">
            {loop
              ? timer
                ? 'Contínuo: o cronômetro conta até você encerrar.'
                : 'Contínuo: o metrônomo segue até você encerrar, sem repetições nem pausas. A preparação toca só no começo.'
              : timer
                ? 'Cada repetição é um bloco de tempo. Não há pausa depois da última.'
                : 'Cada repetição começa com a preparação. Não há pausa depois da última.'}
          </p>
          <div className="form-grid three">
            <Field label="Duração por">
              <select
                value={loop ? 'loop' : timer ? 'seconds' : draft.mode}
                onChange={e => {
                  const value = e.target.value;
                  // A timer always counts seconds: its bar/second choice stays for when the metronome returns.
                  setDraft(c =>
                    value === 'loop'
                      ? { ...c, loop: true }
                      : { ...c, loop: false, mode: timer ? c.mode : (value as 'bars' | 'seconds') },
                  );
                }}
              >
                {!timer && <option value="bars">Compassos</option>}
                <option value="seconds">{timer ? 'Blocos de tempo' : 'Segundos'}</option>
                <option value="loop">Contínuo (sem fim)</option>
              </select>
            </Field>
            {loop ? null : draft.mode === 'bars' && !timer ? (
              <NumberField
                label="Compassos por repetição"
                value={draft.bars}
                min={1}
                max={128}
                onChange={v => set('bars', v)}
              />
            ) : (
              <NumberField
                label="Segundos por repetição"
                value={draft.seconds}
                min={5}
                max={3600}
                hint="De 5 a 3600 (1 hora)."
                onChange={v => set('seconds', v)}
              />
            )}
            {!loop && (
              <NumberField
                label="Repetições"
                value={draft.repetitions}
                min={1}
                max={100}
                onChange={v => set('repetitions', v)}
              />
            )}
            {!timer && (
              <NumberField
                label="Compassos de preparação"
                value={draft.countInBars}
                min={0}
                max={4}
                hint="Contagem antes de tocar."
                onChange={v => set('countInBars', v)}
              />
            )}
            {!loop && (
              <NumberField
                label="Pausa entre repetições (s)"
                value={draft.restSeconds}
                min={0}
                max={300}
                hint="Para respirar e soltar as mãos."
                onChange={v => set('restSeconds', v)}
              />
            )}
          </div>
        </fieldset>
        {!timer && !loop && (
          <fieldset>
            <legend className="eyebrow">PROGRESSÃO DE ANDAMENTO</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.increaseEvery > 0}
                onChange={e => {
                  const on = e.target.checked;
                  // A limit at or below the starting tempo would make the ramp do nothing.
                  setDraft(c =>
                    on
                      ? {
                          ...c,
                          increaseEvery: 2,
                          targetBpm: c.targetBpm > c.bpm ? c.targetBpm : Math.min(300, c.bpm + 10),
                        }
                      : { ...c, increaseEvery: 0 },
                  );
                }}
              />
              Aumentar o andamento aos poucos
            </label>
            {draft.increaseEvery > 0 && (
              <>
                {draft.targetBpm > draft.bpm ? (
                  <p className="hint">
                    +{draft.increaseBpm} BPM a cada{' '}
                    {draft.increaseEvery === 1 ? 'repetição' : `${draft.increaseEvery} repetições`}, até{' '}
                    {draft.targetBpm} BPM.
                  </p>
                ) : (
                  <p className="hint ramp-warning">
                    “Até” está igual ou abaixo do BPM inicial ({draft.bpm}): o andamento não vai subir.
                  </p>
                )}
                <div className="form-grid three">
                  <NumberField
                    label="A cada quantas repetições"
                    value={draft.increaseEvery}
                    min={1}
                    max={20}
                    onChange={v => set('increaseEvery', v)}
                  />
                  <NumberField
                    label="Aumento (BPM)"
                    value={draft.increaseBpm}
                    min={1}
                    max={20}
                    onChange={v => set('increaseBpm', v)}
                  />
                  <NumberField
                    label="Até (BPM)"
                    value={draft.targetBpm}
                    min={20}
                    max={300}
                    hint="O andamento para aí."
                    onChange={v => set('targetBpm', v)}
                  />
                </div>
              </>
            )}
          </fieldset>
        )}
        {!timer && (
          <fieldset>
            <legend className="eyebrow">COMPASSOS SILENCIOSOS</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.silentBars > 0}
                onChange={e => set('silentBars', e.target.checked ? 1 : 0)}
              />
              Alternar compassos com e sem clique
            </label>
            {draft.silentBars > 0 && (
              <>
                <p className="hint">O tempo continua no silêncio: conte por dentro e veja se volta junto.</p>
                <div className="form-grid three">
                  <NumberField
                    label="Com clique"
                    value={draft.audibleBars}
                    min={1}
                    max={16}
                    onChange={v => set('audibleBars', v)}
                  />
                  <NumberField
                    label="Em silêncio"
                    value={draft.silentBars}
                    min={1}
                    max={8}
                    onChange={v => set('silentBars', v)}
                  />
                </div>
              </>
            )}
          </fieldset>
        )}
        {!timer && (
          <fieldset>
            <legend className="eyebrow">AO CONTINUAR DEPOIS DE PAUSAR</legend>
            <label className="check-row">
              <input type="checkbox" checked={resume} onChange={e => setResume(e.target.checked)} />
              {loop ? 'Retomar o compasso interrompido com contagem' : 'Recomeçar a repetição com contagem'}
            </label>
            <p className="hint">
              Vale para este dispositivo. Desmarque para seguir exatamente de onde parou.
            </p>
          </fieldset>
        )}
      </div>
      <ErrorBox message={error} />
      <footer className="modal-actions cycle-footer">
        <p>
          {loop ? (
            <>
              <strong>Contínuo:</strong> sem fim, encerre quando quiser
            </>
          ) : (
            <>
              <strong>Previsão:</strong> {clock(total)} de sessão · {clock(activeSeconds(rounds, total))} de
              prática
            </>
          )}
        </p>
        <button type="button" className="btn secondary" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const parsed = configSchema.safeParse(draft);
            if (!parsed.success) return setError('Revise os valores destacados antes de aplicar.');
            // A timer counts seconds by itself; `mode` stays for when the metronome comes back.
            onApply(draft, resume);
          }}
        >
          Aplicar
        </button>
      </footer>
    </Modal>
  );
}
