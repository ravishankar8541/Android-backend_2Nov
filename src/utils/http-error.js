export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
