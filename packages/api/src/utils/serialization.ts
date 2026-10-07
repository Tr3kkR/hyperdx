import type express from 'express';

export type PreSerialized<T> = T extends string
  ? string | Date
  : T extends (infer U)[]
    ? PreSerialized<U>[]
    : T extends object
      ? { [K in keyof T]: PreSerialized<T[K]> }
      : T;

export function sendJson<TResponse>(
  res: express.Response<TResponse>,
  data: PreSerialized<TResponse>,
): void {
  res.json(data as TResponse);
}
