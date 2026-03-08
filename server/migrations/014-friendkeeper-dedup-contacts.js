export async function up(client) {
  // Deduplicate friendkeeper contacts by display_name (case-insensitive).
  // For each group of duplicates, keep the contact with the highest total
  // communication count and merge events + counts from the rest.

  await client.query(`SET search_path TO friendkeeper`);

  // Find all duplicate groups
  const { rows: dupes } = await client.query(`
    SELECT LOWER(display_name) AS name_key, array_agg(id ORDER BY
      (COALESCE(total_message_count,0) + COALESCE(total_call_count,0) +
       COALESCE(total_facetime_count,0) + COALESCE(total_whatsapp_count,0)) DESC,
      updated_at DESC NULLS LAST
    ) AS ids
    FROM contacts
    GROUP BY LOWER(display_name)
    HAVING COUNT(*) > 1
  `);

  let mergedCount = 0;
  for (const { name_key, ids } of dupes) {
    const keepId = ids[0];
    const removeIds = ids.slice(1);

    // Sum counts from duplicates into the keeper
    await client.query(`
      UPDATE contacts SET
        total_message_count = GREATEST(COALESCE(total_message_count, 0), (
          SELECT COALESCE(MAX(total_message_count), 0) FROM contacts WHERE id = ANY($2)
        )),
        total_call_count = GREATEST(COALESCE(total_call_count, 0), (
          SELECT COALESCE(MAX(total_call_count), 0) FROM contacts WHERE id = ANY($2)
        )),
        total_facetime_count = GREATEST(COALESCE(total_facetime_count, 0), (
          SELECT COALESCE(MAX(total_facetime_count), 0) FROM contacts WHERE id = ANY($2)
        )),
        total_whatsapp_count = GREATEST(COALESCE(total_whatsapp_count, 0), (
          SELECT COALESCE(MAX(total_whatsapp_count), 0) FROM contacts WHERE id = ANY($2)
        )),
        total_whatsapp_call_count = GREATEST(COALESCE(total_whatsapp_call_count, 0), (
          SELECT COALESCE(MAX(total_whatsapp_call_count), 0) FROM contacts WHERE id = ANY($2)
        )),
        last_communication_date = GREATEST(
          last_communication_date,
          (SELECT MAX(last_communication_date) FROM contacts WHERE id = ANY($2))
        ),
        last_outgoing_contact_date = GREATEST(
          last_outgoing_contact_date,
          (SELECT MAX(last_outgoing_contact_date) FROM contacts WHERE id = ANY($2))
        ),
        phone_numbers = COALESCE((
          SELECT jsonb_agg(DISTINCT val) FROM (
            SELECT jsonb_array_elements(COALESCE(phone_numbers, '[]'::jsonb)) AS val
            FROM contacts WHERE id = $1 OR id = ANY($2)
          ) sub
        ), '[]'::jsonb),
        email_addresses = COALESCE((
          SELECT jsonb_agg(DISTINCT val) FROM (
            SELECT jsonb_array_elements(COALESCE(email_addresses, '[]'::jsonb)) AS val
            FROM contacts WHERE id = $1 OR id = ANY($2)
          ) sub
        ), '[]'::jsonb),
        thumbnail_image_data = COALESCE(
          (SELECT thumbnail_image_data FROM contacts WHERE id = $1),
          (SELECT thumbnail_image_data FROM contacts WHERE id = ANY($2) AND thumbnail_image_data IS NOT NULL LIMIT 1)
        )
      WHERE id = $1
    `, [keepId, removeIds]);

    // Move events from duplicates to keeper (skip if event ID already exists under keeper)
    await client.query(`
      UPDATE communication_events SET contact_id = $1
      WHERE contact_id = ANY($2) AND id NOT IN (
        SELECT id FROM communication_events WHERE contact_id = $1
      )
    `, [keepId, removeIds]);

    // Delete any remaining events for removed contacts (FK cascade would handle this,
    // but be explicit in case of conflicts)
    await client.query(`
      DELETE FROM communication_events WHERE contact_id = ANY($1)
    `, [removeIds]);

    // Delete duplicate contacts
    await client.query(`DELETE FROM contacts WHERE id = ANY($1)`, [removeIds]);
    mergedCount += removeIds.length;
  }

  // Also recompute counts from events for contacts where DB count is 0 but events exist
  await client.query(`
    UPDATE contacts c SET
      total_message_count = GREATEST(c.total_message_count, sub.msg),
      total_call_count = GREATEST(c.total_call_count, sub.calls),
      total_facetime_count = GREATEST(c.total_facetime_count, sub.ft)
    FROM (
      SELECT contact_id,
        COUNT(*) FILTER (WHERE type = 'iMessage/SMS') AS msg,
        COUNT(*) FILTER (WHERE type = 'Phone Call') AS calls,
        COUNT(*) FILTER (WHERE type = 'FaceTime') AS ft
      FROM communication_events
      GROUP BY contact_id
    ) sub
    WHERE c.id = sub.contact_id
      AND c.total_message_count = 0 AND c.total_call_count = 0 AND c.total_facetime_count = 0
  `);

  console.log(`  Dedup migration: merged ${mergedCount} duplicate contacts from ${dupes.length} groups`);

  // Reset search_path so the migration runner can write to public.schema_migrations
  await client.query(`SET search_path TO public`);
}
