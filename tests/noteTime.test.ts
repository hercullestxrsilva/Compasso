import { describe, expect, it } from 'vitest';
import { draftMoment, noteTimeHint, stampTime } from '../src/lessons/noteTime';

describe('note times', () => {
  const player = { recordingElapsed: null, hasAudio: true, heard: true, currentTime: 70 };
  it('uses the live recording time while recording, else the player once it was used', () => {
    expect(stampTime({ ...player, recordingElapsed: 125 })).toBe(125);
    expect(stampTime(player)).toBe(70);
    // A player that was never touched would stamp every note at 0:00.
    expect(stampTime({ ...player, heard: false, currentTime: 0 })).toBeNull();
    expect(stampTime({ ...player, heard: false, currentTime: 12 })).toBe(12);
    expect(stampTime({ ...player, hasAudio: false })).toBeNull();
  });
  it('freezes the time when the student starts a note', () => {
    const focused = draftMoment(null, 70);
    expect(focused).toEqual({ at: 70, manual: false });
    // The first key comes 2 s later: still the same moment.
    expect(draftMoment(focused, 72)).toBe(focused);
    // They kept listening before typing: the first key renews it.
    expect(draftMoment(focused, 95)).toEqual({ at: 95, manual: false });
    // Nothing to point at yet: keep what there is.
    expect(draftMoment(null, null)).toBeNull();
    expect(draftMoment(focused, null)).toBe(focused);
  });
  it('never overrides a time the student adjusted or removed', () => {
    const adjusted = { at: 60, manual: true },
      removed = { at: null, manual: true };
    expect(draftMoment(adjusted, 95)).toBe(adjusted);
    expect(draftMoment(removed, 95)).toBe(removed);
  });
  it('explains how to get a time, including for a note written before the audio played', () => {
    expect(noteTimeHint({ canStamp: false, hasText: false, removed: false })).toContain('Dê play');
    expect(noteTimeHint({ canStamp: true, hasText: false, removed: false })).toContain('começa a escrever');
    expect(noteTimeHint({ canStamp: true, hasText: true, removed: false })).toContain('Marcar agora');
    expect(noteTimeHint({ canStamp: true, hasText: true, removed: true })).toContain('sem tempo');
  });
});
