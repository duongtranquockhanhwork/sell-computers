// User helpers shared by registration, guest checkout and Google sign-in.
const v = require('./http');

function parseAddress(body, { requirePhone = false } = {}) {
  return {
    recipient: v.str(body.recipient ?? body.fullName, { field: 'Recipient name', min: 2, max: 120 }),
    phone: v.phone(body.phone, 'Phone', requirePhone),
    addressLine: v.str(body.addressLine, { field: 'Street address', min: 3, max: 255 }),
    ward: v.str(body.ward, { field: 'Ward', max: 100, required: false }),
    district: v.str(body.district, { field: 'District', max: 100, required: false }),
    city: v.str(body.city, { field: 'City / Province', min: 2, max: 100 }),
  };
}

function formatAddress(a) {
  return [a.address_line ?? a.addressLine, a.ward, a.district, a.city].filter(Boolean).join(', ');
}

function addressDto(a) {
  return {
    id: a.id,
    recipient: a.recipient,
    phone: a.phone,
    addressLine: a.address_line,
    ward: a.ward,
    district: a.district,
    city: a.city,
    isDefault: a.is_default,
    formatted: formatAddress(a),
  };
}

async function insertAddress(client, userId, a, makeDefault) {
  if (makeDefault) {
    await client.query('UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND is_default', [userId]);
  }
  const { rows } = await client.query(
    `INSERT INTO addresses (user_id, recipient, phone, address_line, ward, district, city, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [userId, a.recipient, a.phone, a.addressLine, a.ward, a.district, a.city, makeDefault],
  );
  return rows[0];
}

module.exports = { parseAddress, formatAddress, addressDto, insertAddress };
