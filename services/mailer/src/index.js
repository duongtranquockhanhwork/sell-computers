// Mailer service: the only component that talks to SMTP. The API drops jobs on
// the durable "email.send" queue and returns immediately; slow or failing SMTP
// never blocks checkout. Failed jobs are retried up to 3 times with back-off.
const amqp = require('amqplib');
const nodemailer = require('nodemailer');
const { render } = require('./templates');

const AMQP_URL = process.env.AMQP_URL || 'amqp://techhaven:techhaven@localhost:5672';
const QUEUE = 'email.send';
const MAX_ATTEMPTS = 3;

// SMTP_HOST alone is enough for a local catcher such as Mailpit; credentials are
// added when SMTP_USER is set (e.g. Gmail with an App Password).
const smtpConfigured = Boolean(process.env.SMTP_HOST);
const transport = smtpConfigured
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_SECURE || 'true') === 'true',
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}),
  })
  : null;
const FROM = process.env.MAIL_FROM || `TechHaven <${process.env.SMTP_USER || 'no-reply@techhaven.local'}>`;

async function deliver(job) {
  const { subject, html, text } = render(job.template, job.data);
  if (!transport) {
    // Development mode: print the mail instead of sending it, so links are still usable.
    console.log(`[mailer] (SMTP not configured) to=${job.to} subject="${subject}"\n${text}`);
    return;
  }
  const info = await transport.sendMail({ from: FROM, to: job.to, subject, html, text });
  console.log(`[mailer] sent "${subject}" to ${job.to} (${info.messageId})`);
}

async function start() {
  for (;;) {
    try {
      const conn = await amqp.connect(AMQP_URL);
      const ch = await conn.createChannel();
      await ch.assertQueue(QUEUE, { durable: true });
      await ch.prefetch(5);
      console.log(`[mailer] consuming ${QUEUE}; SMTP ${smtpConfigured ? `via ${process.env.SMTP_HOST}` : 'disabled (log only)'}`);
      if (transport) transport.verify().then(() => console.log('[mailer] SMTP connection verified')).catch((e) => console.error('[mailer] SMTP verify failed:', e.message));

      ch.consume(QUEUE, async (msg) => {
        if (!msg) return;
        let job;
        try {
          job = JSON.parse(msg.content.toString());
          await deliver(job);
          ch.ack(msg);
        } catch (err) {
          const attempt = Number(msg.properties.headers?.['x-attempt'] || 1);
          console.error(`[mailer] attempt ${attempt} failed: ${err.message}`);
          ch.ack(msg);
          if (job && attempt < MAX_ATTEMPTS) {
            setTimeout(() => {
              ch.sendToQueue(QUEUE, msg.content, { persistent: true, headers: { 'x-attempt': attempt + 1 } });
            }, 5000 * attempt);
          }
        }
      });
      await new Promise((resolve) => conn.on('close', resolve));
      console.warn('[mailer] connection closed, reconnecting');
    } catch (err) {
      console.log(`[mailer] waiting for RabbitMQ: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

if (require.main === module) start();

module.exports = { deliver };
