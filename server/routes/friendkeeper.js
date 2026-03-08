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

      // Upsert contacts
      for (const c of contacts) {
        await client.query(
          `INSERT INTO contacts (id, first_name, last_name, display_name, phone_numbers,
            email_addresses, thumbnail_image_data, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, NOW())
           ON CONFLICT (id) DO UPDATE SET
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             display_name = EXCLUDED.display_name,
             phone_numbers = EXCLUDED.phone_numbers,
             email_addresses = EXCLUDED.email_addresses,
             thumbnail_image_data = EXCLUDED.thumbnail_image_data,
             updated_at = NOW()`,
          [
            c.id, c.firstName, c.lastName, c.displayName,
            JSON.stringify(c.phoneNumbers || []),
            JSON.stringify(c.emailAddresses || []),
            c.thumbnailImageData || null,
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
// Computes counts and dates from stored events for accuracy
router.get('/api/friendkeeper/export', friendkeeperAuth, async (req, res) => {
  try {
    const data = await withSchema(async (client) => {
      const { rows: contacts } = await client.query(
        `SELECT id, first_name, last_name, display_name, phone_numbers, email_addresses,
                thumbnail_image_data
         FROM contacts ORDER BY display_name`
      );

      const { rows: events } = await client.query(
        `SELECT id, contact_id, date, type, is_from_me, duration, preview
         FROM communication_events ORDER BY date DESC`
      );

      // Group events by contact_id and compute stats
      const eventsByContact = {};
      const statsByContact = {};
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

        if (!statsByContact[ev.contact_id]) {
          statsByContact[ev.contact_id] = {
            msgCount: 0, callCount: 0, ftCount: 0, waCount: 0, waCallCount: 0,
            lastDate: null, lastType: null, lastOutgoing: null,
          };
        }
        const s = statsByContact[ev.contact_id];
        const evDate = new Date(ev.date);

        // Type counts
        if (ev.type === 'iMessage/SMS') s.msgCount++;
        else if (ev.type === 'Phone Call') s.callCount++;
        else if (ev.type === 'FaceTime') s.ftCount++;
        else if (ev.type === 'WhatsApp') s.waCount++;
        else if (ev.type === 'WhatsApp Call') s.waCallCount++;

        // Last communication (events already sorted desc, so first seen is latest)
        if (!s.lastDate) {
          s.lastDate = ev.date;
          s.lastType = ev.type;
        }

        // Last outgoing: messages count, calls count if duration >= 60
        if (!s.lastOutgoing && ev.is_from_me) {
          if (ev.type === 'iMessage/SMS' || ev.type === 'WhatsApp') {
            s.lastOutgoing = ev.date;
          } else if (ev.duration && ev.duration >= 60) {
            s.lastOutgoing = ev.date;
          }
        }
      }

      // Deduplicate contacts by display name, merging events and stats
      const byName = new Map();
      for (const c of contacts) {
        const key = c.display_name;
        if (byName.has(key)) {
          const existing = byName.get(key);
          // Merge: keep the one with more events, combine events from both
          const existingEvents = eventsByContact[existing.id] || [];
          const newEvents = eventsByContact[c.id] || [];
          // Merge events under the primary ID
          if (!eventsByContact[existing.id]) eventsByContact[existing.id] = [];
          eventsByContact[existing.id].push(...newEvents);
          // Merge stats
          const eS = statsByContact[existing.id] || { msgCount: 0, callCount: 0, ftCount: 0, waCount: 0, waCallCount: 0, lastDate: null, lastType: null, lastOutgoing: null };
          const nS = statsByContact[c.id] || { msgCount: 0, callCount: 0, ftCount: 0, waCount: 0, waCallCount: 0, lastDate: null, lastType: null, lastOutgoing: null };
          eS.msgCount += nS.msgCount;
          eS.callCount += nS.callCount;
          eS.ftCount += nS.ftCount;
          eS.waCount += nS.waCount;
          eS.waCallCount += nS.waCallCount;
          if (nS.lastDate && (!eS.lastDate || new Date(nS.lastDate) > new Date(eS.lastDate))) {
            eS.lastDate = nS.lastDate;
            eS.lastType = nS.lastType;
          }
          if (nS.lastOutgoing && (!eS.lastOutgoing || new Date(nS.lastOutgoing) > new Date(eS.lastOutgoing))) {
            eS.lastOutgoing = nS.lastOutgoing;
          }
          statsByContact[existing.id] = eS;
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
        contacts: dedupedContacts.map(c => {
          const s = statsByContact[c.id] || {};
          return {
            id: c.id,
            firstName: c.first_name,
            lastName: c.last_name,
            displayName: c.display_name,
            phoneNumbers: c.phone_numbers || [],
            emailAddresses: c.email_addresses || [],
            thumbnailImageData: c.thumbnail_image_data,
            lastCommunicationDate: s.lastDate || null,
            lastCommunicationType: s.lastType || null,
            lastOutgoingContactDate: s.lastOutgoing || null,
            totalMessageCount: s.msgCount || 0,
            totalCallCount: s.callCount || 0,
            totalFaceTimeCount: s.ftCount || 0,
            totalWhatsAppCount: s.waCount || 0,
            totalWhatsAppCallCount: s.waCallCount || 0,
            communicationEvents: eventsByContact[c.id] || [],
          };
        }),
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
