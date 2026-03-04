import { ZodError } from 'zod';

/**
 * Express middleware factory for Zod validation.
 * Validates req.params, req.query, and/or req.body against provided schemas.
 * On success, overwrites the validated property with parsed values (free trimming/coercion).
 * On failure, responds 400 with { error, errors }.
 */
export function validate(schemas) {
  return (req, res, next) => {
    const allErrors = [];

    for (const key of ['params', 'query', 'body']) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          allErrors.push({
            path: issue.path.length > 0 ? `${key}.${issue.path.join('.')}` : key,
            message: issue.message,
          });
        }
      } else {
        req[key] = result.data;
      }
    }

    if (allErrors.length > 0) {
      return res.status(400).json({
        error: allErrors[0].message,
        errors: allErrors,
      });
    }

    next();
  };
}
