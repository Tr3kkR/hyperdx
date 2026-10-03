import { MAX_TAGS } from '@hyperdx/common-utils/dist/types';

import { alertsPageQuerySchema } from '@/controllers/alertsPage';
import { AlertSource } from '@/models/alert';
import { encodeCursor } from '@/utils/pagination';

const ALERT_ID = '6500000000000000000000bb';
const parse = (query: Record<string, unknown>) =>
  alertsPageQuerySchema.parse(query);

describe('alertsPageQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(parse({})).toEqual({});
  });

  it('normalizes repeatable params and enforces their bounds', () => {
    expect(parse({ tag: 'prod' }).tag).toEqual(['prod']);
    expect(parse({ tag: ['prod', 'web'] }).tag).toEqual(['prod', 'web']);
    expect(parse({ tag: '' }).tag).toBeUndefined();
    expect(() => parse({ tag: Array(MAX_TAGS + 1).fill('t') })).toThrow();
    expect(parse({ tag: Array(MAX_TAGS).fill('t') }).tag).toHaveLength(
      MAX_TAGS,
    );
  });

  it('coerces and bounds the page limit', () => {
    expect(parse({ limit: '25' }).limit).toBe(25);
    expect(parse({ limit: '500' }).limit).toBe(500);
    for (const limit of ['0', '501', '1.5']) {
      expect(() => parse({ limit })).toThrow();
    }
  });

  it('validates search, source and createdBy', () => {
    expect(parse({ search: '  errors ' }).search).toBe('errors');
    expect(() => parse({ search: 'x'.repeat(513) })).toThrow();
    expect(parse({ source: 'tile' }).source).toEqual([AlertSource.TILE]);
    expect(() => parse({ source: 'nope' })).toThrow();
    expect(() => parse({ createdBy: 'not-an-id' })).toThrow();
  });

  it('survives re-parsing its output', () => {
    const once = parse({
      limit: '2',
      tag: ['prod', 'web'],
      source: 'tile',
      state: 'OK',
      search: ' errors ',
      createdBy: ALERT_ID,
    });
    expect(alertsPageQuerySchema.parse(once)).toEqual(once);
  });

  it('requires a valid cursor and limit together', () => {
    const cursor = encodeCursor({ n: 'a', id: ALERT_ID });
    expect(() => parse({ cursor })).toThrow('cursor requires limit');
    expect(parse({ cursor, limit: '2' }).cursor).toBe(cursor);
    for (const invalid of [
      'not a cursor!',
      encodeCursor({ n: 'a', id: 'nope' }),
      encodeCursor({ id: ALERT_ID }),
    ]) {
      expect(() => parse({ cursor: invalid, limit: '2' })).toThrow(
        'invalid cursor',
      );
    }
  });
});
