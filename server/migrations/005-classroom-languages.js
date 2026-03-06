export async function up(client) {
  await client.query(`
    ALTER TABLE classrooms
      ADD COLUMN IF NOT EXISTS target_language VARCHAR(10),
      ADD COLUMN IF NOT EXISTS native_language VARCHAR(10)
  `);
}
