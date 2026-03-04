import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config';
import { logger } from './logger';

// Routes
import healthRouter from './routes/health';
import voiceRouter from './routes/voice';
import authRouter from './routes/auth';
import ordersRouter from './routes/orders';
import flexRouter from './routes/flex';
import studioRouter from './routes/studio';
import debugRouter from './routes/debug';

// WebSocket
import { createConversationRelayWss } from './ws/conversationRelay';

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();

app.set('trust proxy', 1); // necessário atrás do proxy do Railway

// ── Middlewares ───────────────────────────────────────────────────────────────

app.use(cors());

// Morgan — apenas logs de acesso em dev (em prod, log estruturado via logger)
if (config.isDev) {
  app.use(morgan('dev'));
}

// Parse body — Express precisa de texto/xml para Twilio webhooks
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rotas ─────────────────────────────────────────────────────────────────────

app.use(healthRouter);
app.use(voiceRouter);
app.use(authRouter);
app.use(ordersRouter);
app.use(flexRouter);
app.use(studioRouter);
app.use(debugRouter);

// Fallback 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ── HTTP Server ───────────────────────────────────────────────────────────────

const server = http.createServer(app);

// ── WebSocket Server (ConversationRelay) ──────────────────────────────────────

const WS_PATH = '/ws/conversationrelay';
const wss = createConversationRelayWss(WS_PATH);

// Upgrade HTTP -> WebSocket apenas para o path correto
server.on('upgrade', (request, socket, head) => {
  const url = request.url ?? '';

  if (url === WS_PATH || url.startsWith(`${WS_PATH}?`)) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    logger.warn('ws_upgrade_rejected', { url });
    socket.destroy();
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    env: config.nodeEnv,
    baseUrl: config.baseUrl,
    wsUrl: config.wsPublicUrl,
    wsPath: WS_PATH,
  });

  if (config.isDev) {
    console.log(`\n🚀 PagueMenos Demo`);
    console.log(`   HTTP : http://localhost:${config.port}`);
    console.log(`   WS   : ws://localhost:${config.port}${WS_PATH}`);
    console.log(`   Docs : http://localhost:${config.port}/health\n`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('server_shutdown', { signal: 'SIGTERM' });
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('server_shutdown', { signal: 'SIGINT' });
  server.close(() => process.exit(0));
});
