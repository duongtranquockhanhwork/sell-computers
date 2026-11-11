const express = require('express');
const db = require('../db');
const v = require('../lib/http');
const { requireAuth, publicUser } = require('../auth');
const { parseAddress, addressDto, insertAddress } = require('../lib/users');

const router = express.Router();
router.use(requireAuth);

async function listAddresses(userId) {
  const { rows } = await db.query(
    'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC',
    [userId],
  );
  return rows.map(addressDto);
}

router.get('/', async (req, res) => {
  res.json({ user: publicUser(req.user), addresses: await listAddresses(req.user.id) });
});

router.put('/', async (req, res) => {
  const fullName = v.str(req.body.fullName, { field: 'Full name', min: 2, max: 120 });
  const phone = v.phone(req.body.phone, 'Phone', false);
  const { rows } = await db.query(
    `UPDATE users SET full_name = $2, phone = $3, updated_at = NOW() WHERE id = $1
     RETURNING id, email, full_name, phone, role, loyalty_points, created_at,
               (password_hash IS NOT NULL) AS has_password, (google_id IS NOT NULL) AS has_google`,
    [req.user.id, fullName, phone],
  );
  res.json({ user: publicUser(rows[0]) });
});

router.get('/addresses', async (req, res) => {
  res.json({ addresses: await listAddresses(req.user.id) });
});

router.post('/addresses', async (req, res) => {
  const a = parseAddress(req.body);
  await db.tx(async (client) => {
    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM addresses WHERE user_id = $1', [req.user.id]);
    if (rows[0].n >= 10) throw v.badRequest('You can save up to 10 addresses');
    await insertAddress(client, req.user.id, a, Boolean(req.body.isDefault) || rows[0].n === 0);
  });
  res.status(201).json({ addresses: await listAddresses(req.user.id) });
});

router.put('/addresses/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const a = parseAddress(req.body);
  await db.tx(async (client) => {
    if (req.body.isDefault) {
      await client.query('UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND id <> $2', [req.user.id, id]);
    }
    const r = await client.query(
      `UPDATE addresses SET recipient = $3, phone = $4, address_line = $5, ward = $6, district = $7, city = $8,
              is_default = CASE WHEN $9 THEN TRUE ELSE is_default END
        WHERE id = $1 AND user_id = $2`,
      [id, req.user.id, a.recipient, a.phone, a.addressLine, a.ward, a.district, a.city, Boolean(req.body.isDefault)],
    );
    if (!r.rowCount) throw v.notFound('Address not found');
  });
  res.json({ addresses: await listAddresses(req.user.id) });
});

router.post('/addresses/:id/default', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  await db.tx(async (client) => {
    const own = await client.query('SELECT 1 FROM addresses WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!own.rowCount) throw v.notFound('Address not found');
    await client.query('UPDATE addresses SET is_default = FALSE WHERE user_id = $1', [req.user.id]);
    await client.query('UPDATE addresses SET is_default = TRUE WHERE id = $1', [id]);
  });
  res.json({ addresses: await listAddresses(req.user.id) });
});

router.delete('/addresses/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  await db.tx(async (client) => {
    const { rows } = await client.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default', [id, req.user.id]);
    if (!rows.length) throw v.notFound('Address not found');
    if (rows[0].is_default) {
      // Promote the oldest remaining address so a default always exists.
      await client.query(
        `UPDATE addresses SET is_default = TRUE
          WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
        [req.user.id],
      );
    }
  });
  res.json({ addresses: await listAddresses(req.user.id) });
});

module.exports = router;
