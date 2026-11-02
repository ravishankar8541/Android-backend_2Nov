import { HttpError } from '../utils/http-error.js';

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(new HttpError(400, 'Please check the submitted information', 'VALIDATION_ERROR', result.error.flatten()));
    if (source === 'query') req.validatedQuery = result.data;
    else if (source === 'params') req.validatedParams = result.data;
    else req[source] = result.data;
    next();
  };
}
