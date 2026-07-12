import { AUTH_USER_REQUIRED_FIELDS } from './generated/apiContract.js';

export function serializeAuthUser(user, token) {
  const response = {
    id: user.id,
    username: user.username,
    display_name: user.display_name ?? null,
    created_at: user.created_at instanceof Date ? user.created_at.toISOString() : user.created_at,
    native_language: user.native_language ?? null,
    target_language: user.target_language ?? null,
    daily_new_limit: user.daily_new_limit,
    daily_word_goal: user.daily_word_goal,
    total_xp: user.total_xp,
    account_type: user.account_type,
    cefr_level: user.cefr_level ?? null,
  };
  const missing = AUTH_USER_REQUIRED_FIELDS.filter((field) => response[field] === undefined);
  if (missing.length > 0) throw new Error(`Auth response missing contract fields: ${missing.join(', ')}`);
  if (!['student', 'teacher'].includes(response.account_type)) throw new Error('Auth response has invalid account_type');
  return token === undefined ? response : { ...response, token };
}
