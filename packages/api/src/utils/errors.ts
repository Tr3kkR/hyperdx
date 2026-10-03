export enum StatusCode {
  BAD_REQUEST = 400,
  CONFLICT = 409,
  CONTENT_TOO_LARGE = 413,
  FORBIDDEN = 403,
  INTERNAL_SERVER = 500,
  NOT_FOUND = 404,
  OK = 200,
  UNAUTHORIZED = 401,
}

export class BaseError extends Error {
  name: string;

  statusCode: StatusCode;

  isOperational: boolean;

  constructor(
    name: string,
    statusCode: StatusCode,
    isOperational: boolean,
    description: string,
  ) {
    super(description);

    Object.setPrototypeOf(this, BaseError.prototype);

    this.name = name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

export class Api500Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.INTERNAL_SERVER, true, 'Internal Server Error');
  }
}

export class Api400Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.BAD_REQUEST, true, 'Bad Request');
  }
}

export class Api404Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.NOT_FOUND, true, 'Not Found');
  }
}

export const isOperationalError = (error: Error) => {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
};

// A unique-index violation becomes a user-facing collision rather than a 500.
export const isDuplicateKeyError = (e: unknown): boolean =>
  e != null &&
  typeof e === 'object' &&
  ((e as { code?: unknown }).code === 11000 ||
    ((e as { code?: unknown }).code === 'ERR_SQLITE_ERROR' &&
      typeof (e as { message?: unknown }).message === 'string' &&
      (e as { message: string }).message.startsWith(
        'UNIQUE constraint failed:',
      )));
