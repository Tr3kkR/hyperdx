/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, security/detect-object-injection -- Specs restrict columns at each repository boundary. */
export type MapperSpec = {
  virtuals?: boolean;
  json?: readonly string[];
  dates?: readonly string[];
  booleans?: readonly string[];
};

export function rowToDoc(
  row: Record<string, unknown>,
  spec: MapperSpec = {},
): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    const key = column === 'id' ? '_id' : column;
    doc[key] = spec.json?.includes(column)
      ? JSON.parse(value as string)
      : spec.dates?.includes(column)
        ? new Date(value as number)
        : spec.booleans?.includes(column)
          ? Boolean(value)
          : value;
  }
  if (spec.virtuals && doc._id) doc.id = doc._id;
  return doc;
}

export function docToRow(
  doc: Record<string, unknown>,
  spec: MapperSpec = {},
): Record<string, string | number | bigint | Uint8Array | null> {
  const row: Record<string, string | number | bigint | Uint8Array | null> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined || key === 'id') continue;
    const column = key === '_id' ? 'id' : key;
    row[column] =
      value === null
        ? null
        : spec.json?.includes(column)
          ? JSON.stringify(value)
          : spec.dates?.includes(column)
            ? (value as Date).getTime()
            : spec.booleans?.includes(column)
              ? Number(value)
              : (value as string | number | bigint | Uint8Array);
  }
  return row;
}

export const now = (): number => Date.now();
