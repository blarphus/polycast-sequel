const PRODUCTION_CLIENT_ORIGIN = 'https://polycast-sequel.onrender.com';

export function configuredOrigins(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const clientOrigin = env.CLIENT_ORIGIN || (production ? PRODUCTION_CLIENT_ORIGIN : 'http://localhost:5173');
  return [clientOrigin, env.EXTENSION_ORIGIN].filter(Boolean);
}

export { PRODUCTION_CLIENT_ORIGIN };
