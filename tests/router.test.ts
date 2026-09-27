import { describe, expect, it } from 'vitest';
import {
  RESUME_MAX_AGE,
  documentTitle,
  formatRoute,
  isStartAddress,
  isView,
  normalizeRoute,
  pageKey,
  parseRoute,
  resumeRecord,
  resumeRoute,
  sameRoute,
  type Route,
} from '../src/router';

describe('parseRoute', () => {
  it('opens Hoje without a hash or with an unknown one', () => {
    expect(parseRoute('')).toEqual({ view: 'home' });
    expect(parseRoute('#')).toEqual({ view: 'home' });
    expect(parseRoute('#/')).toEqual({ view: 'home' });
    expect(parseRoute('#/hoje')).toEqual({ view: 'home' });
    expect(parseRoute('#/nada-aqui/123')).toEqual({ view: 'home' });
    expect(parseRoute('#conteudo')).toEqual({ view: 'home' });
  });
  it('reads every screen', () => {
    expect(parseRoute('#/repertorio')).toEqual({ view: 'library' });
    expect(parseRoute('#/praticar')).toEqual({ view: 'practice' });
    expect(parseRoute('#/aulas')).toEqual({ view: 'lessons' });
    expect(parseRoute('#/evolucao')).toEqual({ view: 'progress' });
    expect(parseRoute('#/preferencias')).toEqual({ view: 'settings' });
  });
  it('reads the open piece, lesson and practice target', () => {
    expect(parseRoute('#/repertorio/abc-123')).toEqual({ view: 'library', pieceId: 'abc-123' });
    expect(parseRoute('#/aulas/l1')).toEqual({ view: 'lessons', lessonId: 'l1' });
    expect(parseRoute('#/praticar/seg-9')).toEqual({ view: 'practice', target: 'seg-9' });
    expect(parseRoute('#/praticar/piece:p1')).toEqual({ view: 'practice', target: 'piece:p1' });
    expect(parseRoute('#/praticar/piece%3Ap1')).toEqual({ view: 'practice', target: 'piece:p1' });
  });
  it('reads the Evolução tabs', () => {
    expect(parseRoute('#/evolucao/historico')).toEqual({ view: 'progress', tab: 'history' });
    expect(parseRoute('#/evolucao/gravacoes')).toEqual({ view: 'progress', tab: 'recordings' });
    expect(parseRoute('#/evolucao/revisoes')).toEqual({ view: 'progress', tab: 'review' });
    expect(parseRoute('#/evolucao/outra')).toEqual({ view: 'progress' });
  });
  it('tolerates accents, capitals, missing slash and trailing parts', () => {
    expect(parseRoute('#/Repert%C3%B3rio')).toEqual({ view: 'library' });
    expect(parseRoute('#/EVOLUÇÃO/Revisões')).toEqual({ view: 'progress', tab: 'review' });
    expect(parseRoute('#aulas/')).toEqual({ view: 'lessons' });
    expect(parseRoute('#/repertorio/p1/extra')).toEqual({ view: 'library', pieceId: 'p1' });
    expect(parseRoute('#/aulas/l1?x=1')).toEqual({ view: 'lessons', lessonId: 'l1' });
  });
  it('drops ids it cannot trust', () => {
    expect(parseRoute('#/repertorio/%E0%A4%A')).toEqual({ view: 'library' });
    expect(parseRoute(`#/aulas/${'x'.repeat(201)}`)).toEqual({ view: 'lessons' });
    expect(parseRoute('#/aulas/%00')).toEqual({ view: 'lessons' });
    expect(parseRoute('#/praticar/piece:')).toEqual({ view: 'practice' });
    expect(parseRoute('#/repertorio/%20')).toEqual({ view: 'library' });
  });
});

describe('formatRoute', () => {
  it('writes canonical hashes', () => {
    expect(formatRoute({ view: 'home' })).toBe('#/hoje');
    expect(formatRoute({ view: 'library', pieceId: 'p1' })).toBe('#/repertorio/p1');
    expect(formatRoute({ view: 'practice', target: 'piece:p 1' })).toBe('#/praticar/piece:p%201');
    expect(formatRoute({ view: 'progress', tab: 'recordings' })).toBe('#/evolucao/gravacoes');
    expect(formatRoute({ view: 'settings' })).toBe('#/preferencias');
  });
  it('ignores fields of other screens', () => {
    expect(formatRoute({ view: 'lessons', pieceId: 'p1', tab: 'review' })).toBe('#/aulas');
    expect(normalizeRoute({ view: 'home', lessonId: 'l1' })).toEqual({ view: 'home' });
  });
  it('round-trips', () => {
    const routes: Route[] = [
      { view: 'home' },
      { view: 'library' },
      { view: 'library', pieceId: 'a/b c' },
      { view: 'practice', target: 'seg' },
      { view: 'practice', target: 'piece:ç' },
      { view: 'lessons', lessonId: '6f1c2a' },
      { view: 'progress', tab: 'history' },
      { view: 'settings' },
    ];
    for (const route of routes) expect(parseRoute(formatRoute(route))).toEqual(route);
  });
});

describe('route helpers', () => {
  it('compares routes by their address', () => {
    expect(sameRoute({ view: 'library' }, { view: 'library', tab: 'review' })).toBe(true);
    expect(sameRoute({ view: 'library' }, { view: 'library', pieceId: 'p1' })).toBe(false);
  });
  it('treats the practice selection and Evolução tabs as the same screen', () => {
    expect(pageKey({ view: 'practice', target: 'a' })).toBe(pageKey({ view: 'practice' }));
    expect(pageKey({ view: 'progress', tab: 'review' })).toBe(pageKey({ view: 'progress' }));
    expect(pageKey({ view: 'library', pieceId: 'a' })).not.toBe(pageKey({ view: 'library' }));
    expect(pageKey({ view: 'lessons', lessonId: 'a' })).not.toBe(pageKey({ view: 'lessons', lessonId: 'b' }));
  });
  it('titles each view', () => {
    expect(documentTitle({ view: 'library' })).toBe('Repertório · Compasso');
    expect(documentTitle({ view: 'settings' })).toBe('Preferências · Compasso');
    expect(documentTitle({ view: 'library', pieceId: 'p1' }, 'Prelúdio em Dó maior')).toBe(
      'Prelúdio em Dó maior · Compasso',
    );
    expect(documentTitle({ view: 'lessons', lessonId: 'l1' }, '  ')).toBe('Aulas · Compasso');
  });
  it('recognizes view names', () => {
    expect(isView('practice')).toBe(true);
    expect(isView('praticar')).toBe(false);
  });
});

describe('resuming the last screen', () => {
  const now = Date.UTC(2026, 8, 27, 15, 0);
  it('reopens a recent screen', () => {
    const saved = resumeRecord({ view: 'lessons', lessonId: 'l 1' }, now - 60_000);
    expect(resumeRoute(saved, now)).toEqual({ view: 'lessons', lessonId: 'l 1' });
    expect(resumeRoute(resumeRecord({ view: 'progress', tab: 'review' }, now), now)).toEqual({
      view: 'progress',
      tab: 'review',
    });
  });
  it('forgets old, future, Hoje and unreadable records', () => {
    expect(resumeRoute(resumeRecord({ view: 'library' }, now - RESUME_MAX_AGE - 1), now)).toBeNull();
    expect(resumeRoute(resumeRecord({ view: 'library' }, now + 3_600_000), now)).toBeNull();
    expect(resumeRoute(resumeRecord({ view: 'home' }, now), now)).toBeNull();
    expect(resumeRoute(null, now)).toBeNull();
    expect(resumeRoute('{', now)).toBeNull();
    expect(resumeRoute('"#/aulas"', now)).toBeNull();
    expect(resumeRoute(JSON.stringify({ hash: '#/aulas', at: 'ontem' }), now)).toBeNull();
    expect(resumeRoute(JSON.stringify({ hash: '#/qualquer', at: now }), now)).toBeNull();
  });
  it('recognizes the start address', () => {
    expect(['', '#', '#/'].map(isStartAddress)).toEqual([true, true, true]);
    expect(['#/hoje', '#/aulas', '#conteudo'].map(isStartAddress)).toEqual([false, false, false]);
  });
});
