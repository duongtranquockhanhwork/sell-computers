// RabbitMQ publisher/consumer with automatic reconnect.
// Exchanges:
//   techhaven.events (topic) - domain events: product.upserted, product.deleted,
//                              catalog.resync.requested, ...
// Queues:
//   email.send               - consumed by the mailer service
const amqp = require('amqplib');
const config = require('./config');

const EVENTS_EXCHANGE = 'techhaven.events';
const EMAIL_QUEUE = 'email.send';

let channel = null;
let connecting = null;
const consumers = []; // re-registered after a reconnect

async function connect() {
  if (channel) return channel;
  if (connecting) return connecting;
  connecting = (async () => {
    for (;;) {
      try {
        const conn = await amqp.connect(config.amqpUrl);
        conn.on('error', (e) => console.error('[mq] connection error', e.message));
        conn.on('close', () => {
          console.warn('[mq] connection closed, reconnecting');
          channel = null;
          setTimeout(() => connect().catch(() => {}), 2000);
        });
        const ch = await conn.createConfirmChannel();
        await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
        await ch.assertQueue(EMAIL_QUEUE, { durable: true });
        channel = ch;
        for (const c of consumers) await bindConsumer(ch, c);
        console.log('[mq] connected');
        return ch;
      } catch (err) {
        console.log(`[mq] waiting for RabbitMQ: ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

async function bindConsumer(ch, { queue, pattern, handler }) {
  await ch.assertQueue(queue, { durable: true });
  await ch.bindQueue(queue, EVENTS_EXCHANGE, pattern);
  await ch.prefetch(1);
  await ch.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      await handler(JSON.parse(msg.content.toString()), msg.fields.routingKey);
      ch.ack(msg);
    } catch (err) {
      console.error(`[mq] handler for ${queue} failed`, err.message);
      ch.nack(msg, false, false);
    }
  });
}

async function publishEvent(routingKey, payload) {
  try {
    const ch = await connect();
    ch.publish(EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: 'application/json',
    });
  } catch (err) {
    console.error(`[mq] failed to publish ${routingKey}`, err.message);
  }
}

// Fire-and-forget: the HTTP request never waits for SMTP.
async function sendEmail(to, template, data) {
  try {
    const ch = await connect();
    ch.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify({ to, template, data })), {
      persistent: true,
      contentType: 'application/json',
    });
  } catch (err) {
    console.error('[mq] failed to queue email', err.message);
  }
}

async function consumeEvents(queue, pattern, handler) {
  const c = { queue, pattern, handler };
  consumers.push(c);
  if (channel) await bindConsumer(channel, c);
}

module.exports = { connect, publishEvent, sendEmail, consumeEvents, EVENTS_EXCHANGE };
