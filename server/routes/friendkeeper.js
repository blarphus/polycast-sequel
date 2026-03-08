import { Router } from 'express';
import pool from '../db.js';
import logger from '../logger.js';

const router = Router();

// Bearer token auth middleware
function friendkeeperAuth(req, res, next) {
  const apiKey = process.env.FRIENDKEEPER_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'FriendKeeper API not configured' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${apiKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Helper: run a callback within the friendkeeper schema
async function withSchema(fn) {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO friendkeeper');
    return await fn(client);
  } finally {
    client.release();
  }
}

// POST /api/friendkeeper/sync — bulk upsert contacts + events
router.post('/api/friendkeeper/sync', friendkeeperAuth, async (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: 'contacts array required' });
    }

    const client = await pool.connect();
    try {
      await client.query('SET search_path TO friendkeeper');
      await client.query('BEGIN');

      let contactCount = 0;
      let eventCount = 0;

      // Upsert contacts (including counts/dates from the collector)
      for (const c of contacts) {
        await client.query(
          `INSERT INTO contacts (id, first_name, last_name, display_name, phone_numbers,
            email_addresses, thumbnail_image_data,
            last_communication_date, last_communication_type, last_outgoing_contact_date,
            total_message_count, total_call_count, total_facetime_count,
            total_whatsapp_count, total_whatsapp_call_count, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
           ON CONFLICT (id) DO UPDATE SET
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             display_name = EXCLUDED.display_name,
             phone_numbers = EXCLUDED.phone_numbers,
             email_addresses = EXCLUDED.email_addresses,
             thumbnail_image_data = EXCLUDED.thumbnail_image_data,
             last_communication_date = EXCLUDED.last_communication_date,
             last_communication_type = EXCLUDED.last_communication_type,
             last_outgoing_contact_date = EXCLUDED.last_outgoing_contact_date,
             total_message_count = EXCLUDED.total_message_count,
             total_call_count = EXCLUDED.total_call_count,
             total_facetime_count = EXCLUDED.total_facetime_count,
             total_whatsapp_count = EXCLUDED.total_whatsapp_count,
             total_whatsapp_call_count = EXCLUDED.total_whatsapp_call_count,
             updated_at = NOW()`,
          [
            c.id, c.firstName, c.lastName, c.displayName,
            JSON.stringify(c.phoneNumbers || []),
            JSON.stringify(c.emailAddresses || []),
            c.thumbnailImageData || null,
            c.lastCommunicationDate || null,
            c.lastCommunicationType || null,
            c.lastOutgoingContactDate || null,
            c.totalMessageCount || 0,
            c.totalCallCount || 0,
            c.totalFaceTimeCount || 0,
            c.totalWhatsAppCount || 0,
            c.totalWhatsAppCallCount || 0,
          ]
        );
        contactCount++;
      }

      // Batch insert events (500 at a time)
      const stripNulls = (s) => s ? s.replace(/\x00/g, '') : null;
      const allEvents = [];
      for (const c of contacts) {
        if (Array.isArray(c.communicationEvents)) {
          for (const ev of c.communicationEvents) {
            allEvents.push([ev.id, c.id, ev.date, ev.type, ev.isFromMe || false, ev.duration || null, stripNulls(ev.preview)]);
          }
        }
      }

      const BATCH = 500;
      for (let i = 0; i < allEvents.length; i += BATCH) {
        const batch = allEvents.slice(i, i + BATCH);
        const values = [];
        const params = [];
        batch.forEach((row, idx) => {
          const off = idx * 7;
          values.push(`($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7})`);
          params.push(...row);
        });
        await client.query(
          `INSERT INTO communication_events (id, contact_id, date, type, is_from_me, duration, preview)
           VALUES ${values.join(',')}
           ON CONFLICT (id) DO NOTHING`,
          params
        );
      }
      eventCount = allEvents.length;

      await client.query('COMMIT');
      logger.info(`FriendKeeper sync: ${contactCount} contacts, ${eventCount} events`);
      res.json({ ok: true, contacts: contactCount, events: eventCount });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'FriendKeeper sync error');
    res.status(500).json({ error: 'Sync failed' });
  }
});

// GET /api/friendkeeper/contacts — list all contacts (no events)
router.get('/api/friendkeeper/contacts', friendkeeperAuth, async (req, res) => {
  try {
    const result = await withSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT id, first_name, last_name, display_name, phone_numbers, email_addresses,
                thumbnail_image_data, last_communication_date, last_communication_type,
                last_outgoing_contact_date, total_message_count, total_call_count,
                total_facetime_count, total_whatsapp_count, total_whatsapp_call_count,
                updated_at
         FROM contacts ORDER BY display_name`
      );
      return rows;
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'FriendKeeper contacts list error');
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// GET /api/friendkeeper/contacts/:id/events — recent events for a contact
router.get('/api/friendkeeper/contacts/:id/events', friendkeeperAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const result = await withSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT id, contact_id, date, type, is_from_me, duration, preview, created_at
         FROM communication_events
         WHERE contact_id = $1
         ORDER BY date DESC
         LIMIT $2`,
        [req.params.id, limit]
      );
      return rows;
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'FriendKeeper events list error');
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/friendkeeper/export — full ContactsCache JSON (same shape the Swift app parses)
// Uses collector-provided counts (accurate) + stored events for timeline
router.get('/api/friendkeeper/export', friendkeeperAuth, async (req, res) => {
  try {
    const data = await withSchema(async (client) => {
      const { rows: contacts } = await client.query(
        `SELECT id, first_name, last_name, display_name, phone_numbers, email_addresses,
                thumbnail_image_data, last_communication_date, last_communication_type,
                last_outgoing_contact_date, total_message_count, total_call_count,
                total_facetime_count, total_whatsapp_count, total_whatsapp_call_count
         FROM contacts ORDER BY display_name`
      );

      const { rows: events } = await client.query(
        `SELECT id, contact_id, date, type, is_from_me, duration, preview
         FROM communication_events ORDER BY date DESC`
      );

      // Group events by contact_id (for timeline only)
      const eventsByContact = {};
      for (const ev of events) {
        if (!eventsByContact[ev.contact_id]) eventsByContact[ev.contact_id] = [];
        eventsByContact[ev.contact_id].push({
          id: ev.id,
          date: ev.date,
          type: ev.type,
          isFromMe: ev.is_from_me,
          duration: ev.duration,
          preview: ev.preview,
          contactIdentifier: ev.contact_id,
        });
      }

      // Deduplicate contacts by display name, merging counts and events
      const byName = new Map();
      for (const c of contacts) {
        const key = c.display_name;
        if (byName.has(key)) {
          const existing = byName.get(key);
          // Merge events
          if (!eventsByContact[existing.id]) eventsByContact[existing.id] = [];
          eventsByContact[existing.id].push(...(eventsByContact[c.id] || []));
          // Sum counts
          existing.total_message_count += c.total_message_count || 0;
          existing.total_call_count += c.total_call_count || 0;
          existing.total_facetime_count += c.total_facetime_count || 0;
          existing.total_whatsapp_count += c.total_whatsapp_count || 0;
          existing.total_whatsapp_call_count += c.total_whatsapp_call_count || 0;
          // Keep most recent dates
          if (c.last_communication_date && (!existing.last_communication_date || new Date(c.last_communication_date) > new Date(existing.last_communication_date))) {
            existing.last_communication_date = c.last_communication_date;
            existing.last_communication_type = c.last_communication_type;
          }
          if (c.last_outgoing_contact_date && (!existing.last_outgoing_contact_date || new Date(c.last_outgoing_contact_date) > new Date(existing.last_outgoing_contact_date))) {
            existing.last_outgoing_contact_date = c.last_outgoing_contact_date;
          }
          // Keep thumbnail if primary doesn't have one
          if (!existing.thumbnail_image_data && c.thumbnail_image_data) {
            existing.thumbnail_image_data = c.thumbnail_image_data;
          }
          // Merge phone numbers and emails
          const phones = new Set([...(existing.phone_numbers || []), ...(c.phone_numbers || [])]);
          existing.phone_numbers = [...phones];
          const emails = new Set([...(existing.email_addresses || []), ...(c.email_addresses || [])]);
          existing.email_addresses = [...emails];
        } else {
          byName.set(key, c);
        }
      }

      const dedupedContacts = [...byName.values()];

      return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        contacts: dedupedContacts.map(c => ({
          id: c.id,
          firstName: c.first_name,
          lastName: c.last_name,
          displayName: c.display_name,
          phoneNumbers: c.phone_numbers || [],
          emailAddresses: c.email_addresses || [],
          thumbnailImageData: c.thumbnail_image_data,
          lastCommunicationDate: c.last_communication_date,
          lastCommunicationType: c.last_communication_type,
          lastOutgoingContactDate: c.last_outgoing_contact_date,
          totalMessageCount: c.total_message_count || 0,
          totalCallCount: c.total_call_count || 0,
          totalFaceTimeCount: c.total_facetime_count || 0,
          totalWhatsAppCount: c.total_whatsapp_count || 0,
          totalWhatsAppCallCount: c.total_whatsapp_call_count || 0,
          communicationEvents: eventsByContact[c.id] || [],
        })),
      };
    });

    res.json(data);
  } catch (err) {
    logger.error({ err }, 'FriendKeeper export error');
    res.status(500).json({ error: 'Export failed' });
  }
});

// GET /api/friendkeeper/categories — get all category assignments
router.get('/api/friendkeeper/categories', friendkeeperAuth, async (req, res) => {
  try {
    const result = await withSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT key, value FROM sync_metadata WHERE key = 'categories'`
      );
      return rows[0]?.value ? JSON.parse(rows[0].value) : [];
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'FriendKeeper categories get error');
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// PUT /api/friendkeeper/categories — save all category assignments
router.put('/api/friendkeeper/categories', friendkeeperAuth, async (req, res) => {
  try {
    const { assignments } = req.body;
    if (!Array.isArray(assignments)) {
      return res.status(400).json({ error: 'assignments array required' });
    }
    await withSchema(async (client) => {
      await client.query(
        `INSERT INTO sync_metadata (key, value) VALUES ('categories', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(assignments)]
      );
    });
    res.json({ ok: true, count: assignments.length });
  } catch (err) {
    logger.error({ err }, 'FriendKeeper categories save error');
    res.status(500).json({ error: 'Failed to save categories' });
  }
});

// GET /api/friendkeeper/important — get important contact IDs
router.get('/api/friendkeeper/important', friendkeeperAuth, async (req, res) => {
  try {
    const result = await withSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT key, value FROM sync_metadata WHERE key = 'importantContacts'`
      );
      return rows[0]?.value ? JSON.parse(rows[0].value) : [];
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'FriendKeeper important get error');
    res.status(500).json({ error: 'Failed to fetch important contacts' });
  }
});

// PUT /api/friendkeeper/important — save important contact IDs
router.put('/api/friendkeeper/important', friendkeeperAuth, async (req, res) => {
  try {
    const { contactIds } = req.body;
    if (!Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'contactIds array required' });
    }
    await withSchema(async (client) => {
      await client.query(
        `INSERT INTO sync_metadata (key, value) VALUES ('importantContacts', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(contactIds)]
      );
    });
    res.json({ ok: true, count: contactIds.length });
  } catch (err) {
    logger.error({ err }, 'FriendKeeper important save error');
    res.status(500).json({ error: 'Failed to save important contacts' });
  }
});

export default router;
