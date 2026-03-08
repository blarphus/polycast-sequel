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
      const allEvents = [];
      for (const c of contacts) {
        if (Array.isArray(c.communicationEvents)) {
          for (const ev of c.communicationEvents) {
            allEvents.push([ev.id, c.id, ev.date, ev.type, ev.isFromMe || false, ev.duration || null, ev.preview || null]);
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

      return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        contacts: contacts.map(c => {
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

export default router;
