import { describe, expect, it } from 'vitest';
import { matchesSearch, searchKey } from '../src/domain';

describe('search', () => {
  it('ignores accents, the cedilla and case', () => {
    expect(searchKey('Prelúdio em Dó Maior')).toBe('preludio em do maior');
    expect(searchKey('Canção')).toBe('cancao');
    expect(matchesSearch('Prelúdio Teste · Chopin', 'preludio')).toBe(true);
    expect(matchesSearch('Estudo em Lá menor', 'LA MENOR')).toBe(true);
    expect(matchesSearch('Noturno', 'nóturno')).toBe(true);
  });

  it('trims the query and finds everything with an empty one', () => {
    expect(matchesSearch('Invenção nº 1', '  invencao ')).toBe(true);
    expect(matchesSearch('Invenção nº 1', '')).toBe(true);
    expect(matchesSearch('Invenção nº 1', 'sonata')).toBe(false);
  });
});
