// Assistant service (AI features):
//  - POST /chat: shopping assistant that recommends products from the catalogue.
//  - Sentiment worker: consumes comment.created events from RabbitMQ and answers
//    with comment.sentiment, which the API stores and pushes to open pages.
const express = require('express');
const amqp = require('amqplib');
const { analyse } = require('./sentiment');
const { chat, llmEnabled, provider, providerLabel } = require('./chat');

const PORT = Number(process.env.PORT || 4200);
const AMQP_URL = process.env.AMQP_URL || 'amqp://techhaven:techhaven@localhost:5672';
const EXCHANGE = 'techhaven.events';
const QUEUE = 'assistant.sentiment';

const app = express();
app.use(express.json({ limit: '32kb' }));

// Simple in-memory per-IP limiter; the gateway forwards the client address.
const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();
function limited(req) {
  const ip = req.get('x-real-ip') || req.ip;
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > 20;
}

app.get('/health', (req, res) => res.json({ status: 'ok', llm: llmEnabled, provider }));

app.post('/api/assistant/chat', async (req, res) => {
  if (limited(req)) return res.status(429).json({ error: 'Too many messages, please wait a minute.' });
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (message.length < 2 || message.length > 500) return res.status(400).json({ error: 'Message must be 2-500 characters' });
  const history = Array.isArray(req.body.history) ? req.body.history.filter((h) => h && typeof h.text === 'string').slice(-6) : [];
  try {
    res.json(await chat(message, history));
  } catch (err) {
    console.error('[assistant] chat failed', err.message);
    res.status(503).json({ error: 'The assistant is temporarily unavailable' });
  }
});

app.post('/api/assistant/sentiment', (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text : '';
  if (!text.trim()) return res.status(400).json({ error: 'Text is required' });
  res.json(analyse(text));
});

async function startWorker() {
  for (;;) {
    try {
      const conn = await amqp.connect(AMQP_URL);
      const ch = await conn.createConfirmChannel();
      await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
      await ch.assertQueue(QUEUE, { durable: true });
      await ch.bindQueue(QUEUE, EXCHANGE, 'comment.created');
      await ch.prefetch(20);
      await ch.consume(QUEUE, (msg) => {
        if (!msg) return;
        try {
          const { id, content } = JSON.parse(msg.content.toString());
          const result = analyse(content);
          ch.publish(EXCHANGE, 'comment.sentiment', Buffer.from(JSON.stringify({ id, sentiment: result.sentiment, score: result.score })), { persistent: true });
        } catch (err) {
          console.error('[assistant] bad comment event', err.message);
        }
        ch.ack(msg);
      });
      // Ask the API (one replica) for comments that were never analysed.
      ch.publish(EXCHANGE, 'sentiment.backfill.requested', Buffer.from('{}'), { persistent: true });
      console.log('[assistant] sentiment worker consuming comment.created');
      await new Promise((resolve) => conn.on('close', resolve));
    } catch (err) {
      console.log(`[assistant] waiting for RabbitMQ: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`[assistant] listening on :${PORT} (language model: ${llmEnabled ? providerLabel : 'none, rule-based replies'})`));
  startWorker();
}

module.exports = app;
