import crypto from 'crypto';

const CLASS_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomString(alphabet, length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function makeClassCode(length = 8) {
  return randomString(CLASS_CODE_ALPHABET, length);
}

export function makeInviteToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export async function generateUniqueClassIdentity(client) {
  while (true) {
    const classCode = makeClassCode();
    const inviteToken = makeInviteToken();
    const { rows } = await client.query(
      `SELECT EXISTS(SELECT 1 FROM classrooms WHERE class_code = $1) AS code_exists,
              EXISTS(SELECT 1 FROM classrooms WHERE invite_token = $2) AS token_exists`,
      [classCode, inviteToken],
    );
    if (!rows[0]?.code_exists && !rows[0]?.token_exists) {
      return { classCode, inviteToken };
    }
  }
}
