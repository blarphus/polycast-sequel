// Migration 015: Slim down FriendKeeper data
// - Drop preview column from communication_events (no longer sent/stored)
// - Drop thumbnail_image_data column from contacts (no longer sent/stored)
// - Delete events older than 90 days (counts are preserved on contacts table)

export async function up(client) {
  await client.query('SET search_path TO friendkeeper');

  // Drop preview column — message content no longer stored
  await client.query(`ALTER TABLE communication_events DROP COLUMN IF EXISTS preview`);

  // Drop thumbnail column — thumbnails no longer synced to server
  await client.query(`ALTER TABLE contacts DROP COLUMN IF EXISTS thumbnail_image_data`);

  // Age out old events — counts are preserved as aggregated totals on the contacts table
  const { rowCount } = await client.query(
    `DELETE FROM communication_events WHERE date < NOW() - INTERVAL '90 days'`
  );
  console.log(`  Deleted ${rowCount} events older than 90 days`);

  // Reset search_path so the migration runner can write to public.schema_migrations
  await client.query(`SET search_path TO public`);
}
