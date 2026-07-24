import { ensureScheduleCurrent } from '../lib/dictionaryScheduleQueries.js';

/**
 * Reconcile schedule state left dirty by pre-046 mutation paths.
 *
 * This intentionally runs the real scheduler for every affected user instead
 * of merely advancing scheduled_version. The latter would hide stale queues.
 */
export async function up(client) {
  const { rows } = await client.query(
    `SELECT user_id
       FROM user_schedule_state
      WHERE schedule_version IS DISTINCT FROM scheduled_version
      ORDER BY user_id`,
  );
  for (const { user_id: userId } of rows) {
    await ensureScheduleCurrent(client, userId, 'UTC', { withinTransaction: true });
  }
}
