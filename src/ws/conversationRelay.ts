import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import twilio from 'twilio';
import { config } from '../config';
import { logger, maskPhone } from '../logger';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  VoiceSession,
} from '../core/sessionManager';
import {
  detectIssueType,
  detectHumanRequest,
  detectUrgency,
  shouldEscalate,
  resolveIssue,
  buildSummary,
  buildNextBestAction,
  IssueType,
} from '../core/engine';
import { getLastOrderByPhone, getOrderById } from '../data/store';

// ── Tipos dos eventos ConversationRelay ───────────────────────────────────────

interface SetupEvent {
  type: 'setup';
  callSid: string;
  from: string;
  to: string;
  accountSid: string;
  parameters?: Record<string, string>;
}

interface PromptEvent {
  type: 'prompt';
  voicePrompt: string;
  last: boolean;
  confidence?: number;
}

interface DtmfEvent {
  type: 'dtmf';
  digits: string;
}

interface InterruptEvent {
  type: 'interrupt';
}

type InboundEvent = SetupEvent | PromptEvent | DtmfEvent | InterruptEvent;

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/** Envia texto para TTS */
function speak(ws: WebSocket, text: string): void {
  send(ws, { type: 'text', token: text, last: true });
}

/** Encerra a chamada via WebSocket */
function endCall(ws: WebSocket): void {
  send(ws, { type: 'end' });
}

/** Detecta se o input é um número de canal válido (whatsapp=1, sms=2) */
function parseChannelChoice(input: string): 'whatsapp' | 'sms' | null {
  const clean = input.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (clean === '1' || clean.includes('whatsapp') || clean.includes('zap')) return 'whatsapp';
  if (clean === '2' || clean.includes('sms') || clean.includes('torpedo')) return 'sms';
  return null;
}

/** Extrai sequência de 6 dígitos de uma string */
function extractCode(input: string): string | null {
  const match = input.replace(/\s/g, '').match(/\d{6}/);
  return match ? match[0] : null;
}

/** Detecta escolha 1 ou 2 */
function parseChoice12(input: string): '1' | '2' | null {
  const clean = input.trim().replace(/\D/g, '');
  if (clean === '1') return '1';
  if (clean === '2') return '2';
  const lower = input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (lower.includes('esse') || lower.includes('sim') || lower.includes('primeiro')) return '1';
  if (lower.includes('outro') || lower.includes('diferente') || lower.includes('nao')) return '2';
  return null;
}

/** Chama REST API Twilio para redirecionar chamada para Flex */
async function redirectCallToFlex(callSid: string, session: VoiceSession): Promise<void> {
  const workflowSid = config.twilio.flexWorkflowSid;
  const wsid = config.twilio.flexWorkspaceSid;

  if (!workflowSid || !wsid) {
    logger.warn('flex_redirect_skipped', { reason: 'flex_not_configured' });
    return;
  }

  try {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);

    const taskAttributes = JSON.stringify({
      channel: 'whatsapp_call',
      customerPhoneFull: session.phoneNumber,
      customerPhone: maskPhone(session.phoneNumber),
      orderId: session.orderId ?? null,
      issueType: session.issueType ?? null,
      authStatus: session.authStatus,
      authAttempts: session.authAttempts,
      handoffReason: session.handoffReason ?? 'agent_request',
      summary: buildSummary({
        channel: 'whatsapp_call',
        phoneNumber: session.phoneNumber,
        authStatus: session.authStatus,
        authChannel: session.authChannel,
        authAttempts: session.authAttempts,
        orderId: session.orderId,
        issueType: session.issueType as IssueType | undefined,
        postAuthTurns: session.postAuthTurns,
        misunderstandCount: session.misunderstandCount,
        handoffReason: session.handoffReason,
      }),
    });

    // Redireciona a chamada para enfileirar no TaskRouter
    const enqueueUrl =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Enqueue workflowSid="${workflowSid}">` +
      `<Task>${taskAttributes}</Task>` +
      `</Enqueue>` +
      `</Response>`;

    await client.calls(callSid).update({ twiml: enqueueUrl });
    logger.info('call_redirected_to_flex', { callSid, phone: maskPhone(session.phoneNumber) });
  } catch (err) {
    logger.error('flex_redirect_error', { callSid, error: String(err) });
  }
}

/** Chama /api/auth/start via HTTP interno */
async function callAuthStart(phoneNumber: string, channel: 'whatsapp' | 'sms'): Promise<{ status: string }> {
  const baseUrl = config.baseUrl;
  const resp = await fetch(`${baseUrl}/api/auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, channel }),
  });
  return resp.json() as Promise<{ status: string }>;
}

/** Chama /api/auth/check via HTTP interno */
async function callAuthCheck(phoneNumber: string, code: string): Promise<{ approved: boolean }> {
  const baseUrl = config.baseUrl;
  const resp = await fetch(`${baseUrl}/api/auth/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, code }),
  });
  return resp.json() as Promise<{ approved: boolean }>;
}

// ── Machine de estados ────────────────────────────────────────────────────────

async function handlePrompt(ws: WebSocket, session: VoiceSession, input: string): Promise<void> {
  const callSid = session.callSid;
  const phone = session.phoneNumber;

  // ── Detectores globais ────────────────────────────────────────────────────
  if (detectHumanRequest(input) && !['ESCALATING', 'DONE'].includes(session.state)) {
    await doEscalate(ws, callSid, 'user_request');
    return;
  }

  if (detectUrgency(input) && !['ESCALATING', 'DONE'].includes(session.state)) {
    updateSession(callSid, { urgencyDetected: true });
    await doEscalate(ws, callSid, 'urgency_detected');
    return;
  }

  // ── Estados ───────────────────────────────────────────────────────────────
  switch (session.state) {
    case 'CHOOSING_AUTH_CHANNEL': {
      const channel = parseChannelChoice(input);
      if (!channel) {
        speak(ws, 'Desculpe, não entendi. Diga "WhatsApp" ou "SMS" para receber o código.');
        return;
      }
      updateSession(callSid, { authChannel: channel });

      try {
        await callAuthStart(phone, channel);
        speak(ws,
          `Ok, enviei o código por ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}. ` +
          `Me diga o código de 6 dígitos.`
        );
        updateSession(callSid, { state: 'WAITING_CODE' });
      } catch {
        speak(ws,
          'Tive um problema ao enviar o código. Quer tentar receber por SMS? Diga "SMS" ou "WhatsApp".'
        );
      }
      break;
    }

    case 'WAITING_CODE': {
      const code = extractCode(input);
      if (!code) {
        speak(ws, 'Não ouvi o código corretamente. Me diga os 6 dígitos, por favor.');
        return;
      }

      let approved = false;
      try {
        const result = await callAuthCheck(phone, code);
        approved = result.approved;
      } catch {
        speak(ws, 'Tive um problema ao verificar o código. Vou te passar para um atendente.');
        await doEscalate(ws, callSid, 'auth_check_error');
        return;
      }

      if (approved) {
        updateSession(callSid, { authStatus: 'approved', state: 'AUTHENTICATED' });
        logger.info('auth_approved', { phone: maskPhone(phone) });
        await presentLastOrder(ws, callSid, phone);
      } else {
        const attempts = session.authAttempts + 1;
        updateSession(callSid, { authAttempts: attempts, authStatus: attempts >= 2 ? 'failed' : 'pending' });

        if (attempts >= 2) {
          logger.warn('auth_failed', { phone: maskPhone(phone), attempts });
          speak(ws, 'O código não confere por duas vezes. Por segurança, vou te transferir para um atendente.');
          await doEscalate(ws, callSid, 'auth_failed');
        } else {
          speak(ws, 'Código incorreto. Tente novamente — me diga os 6 dígitos.');
        }
      }
      break;
    }

    case 'ORDER_PRESENTED': {
      const choice = parseChoice12(input);
      if (!choice) {
        speak(ws, 'Não entendi. Diga "um" para esse pedido ou "dois" para outro.');
        return;
      }

      if (choice === '1') {
        updateSession(callSid, { state: 'IDENTIFYING_ISSUE' });
        speak(ws, 'Ok. O que aconteceu com esse pedido? Pode ser: atraso na entrega, item faltando, ou outro problema.');
      } else {
        speak(ws, 'Entendido. Qual o número do pedido que você quer consultar?');
        updateSession(callSid, { state: 'WAITING_ORDER_ID' });
      }
      break;
    }

    case 'WAITING_ORDER_ID': {
      const orderIdMatch = input.replace(/\s/g, '').match(/[A-Z]?ORD[-]?\d+|#?\d{3,}/i);
      const orderId = orderIdMatch ? orderIdMatch[0].replace('#', '').toUpperCase() : null;

      if (!orderId) {
        speak(ws, 'Não consegui identificar o número do pedido. Pode repetir? Por exemplo: "ORD-001" ou só os números.');
        return;
      }

      const order = getOrderById(orderId, phone);
      if (!order) {
        speak(ws,
          `Não encontrei o pedido ${orderId} associado a este número. ` +
          `Verifique o número e tente de novo, ou diga "atendente" para falar com alguém.`
        );
        return;
      }

      updateSession(callSid, { orderId: order.id, orderData: order as unknown as Record<string, unknown>, state: 'IDENTIFYING_ISSUE' });
      speak(ws,
        `Encontrei o pedido ${order.id}: ${order.itemSummary}, status ${order.statusLabel}. ` +
        `Qual o problema? Atraso, item faltando ou outro?`
      );
      break;
    }

    case 'IDENTIFYING_ISSUE': {
      const issue = detectIssueType(input);
      const turns = session.postAuthTurns + 1;
      updateSession(callSid, { postAuthTurns: turns });

      if (!issue) {
        if (turns >= 3) {
          speak(ws, 'Não consegui entender o problema. Para te ajudar melhor, vou te passar para um atendente.');
          await doEscalate(ws, callSid, 'max_misunderstandings');
        } else {
          updateSession(callSid, { misunderstandCount: session.misunderstandCount + 1 });
          speak(ws,
            'Não entendi bem. Pode descrever o problema de outra forma? ' +
            'Por exemplo: "meu pedido atrasou", "veio um item errado", ou "tenho uma dúvida sobre cobrança".'
          );
        }
        return;
      }

      if (issue === 'billing') {
        updateSession(callSid, { issueType: issue });
        speak(ws, 'Questões de cobrança são tratadas pela equipe especializada. Vou te transferir agora com todo o contexto.');
        await doEscalate(ws, callSid, 'billing_issue');
        return;
      }

      // Garante que temos um orderId
      const orderId = session.orderId ?? (getLastOrderByPhone(phone)?.id ?? 'N/A');
      updateSession(callSid, { issueType: issue, orderId, state: 'RESOLVING' });

      const result = resolveIssue(issue, orderId);

      if (result.shouldEscalate || !result.resolved) {
        speak(ws, result.message);
        await doEscalate(ws, callSid, result.action);
      } else {
        logger.info('resolved', { phone: maskPhone(phone), orderId, issue, action: result.action });
        speak(ws,
          `${result.message} ` +
          `Posso ajudar com mais alguma coisa?`
        );
        updateSession(callSid, { state: 'DONE' });
        // Aguarda 8s e encerra (usuário pode falar de novo; se não, a chamada termina)
        setTimeout(() => {
          endCall(ws);
          deleteSession(callSid);
        }, 8000);
      }
      break;
    }

    case 'DONE':
      // Nada mais a fazer
      endCall(ws);
      break;

    default:
      speak(ws, 'Desculpe, houve um problema. Vou te passar para um atendente.');
      await doEscalate(ws, callSid, 'unexpected_state');
  }
}

async function presentLastOrder(ws: WebSocket, callSid: string, phone: string): Promise<void> {
  const order = getLastOrderByPhone(phone);

  if (!order) {
    speak(ws,
      'Não encontrei pedidos recentes associados a este número. ' +
      'Pode me dizer o número do pedido que quer consultar?'
    );
    updateSession(callSid, { state: 'WAITING_ORDER_ID' });
    return;
  }

  updateSession(callSid, {
    orderId: order.id,
    orderData: order as unknown as Record<string, unknown>,
    state: 'ORDER_PRESENTED',
  });

  const prefix = order.confidence === 'low'
    ? 'Posso estar vendo um pedido mais antigo. '
    : '';

  speak(ws,
    `${prefix}Validado. Encontrei um pedido recente associado a este número: ` +
    `pedido ${order.id}, ${order.itemSummary}, ` +
    `status ${order.statusLabel} com previsão ${order.eta}. ` +
    `É sobre esse pedido — diga um — ou sobre outro — diga dois?`
  );

  logger.info('last_order_presented', {
    phone: maskPhone(phone),
    orderId: order.id,
    confidence: order.confidence,
  });
}

async function doEscalate(ws: WebSocket, callSid: string, reason: string): Promise<void> {
  const session = getSession(callSid);
  if (!session || session.escalated) return;

  updateSession(callSid, { escalated: true, handoffReason: reason, state: 'ESCALATING' });

  // Avisa o usuário
  speak(ws,
    'Vou te transferir para um atendente agora e já vou mandar um resumo pra você não precisar repetir. Um momento.'
  );

  logger.info('escalated', {
    phone: maskPhone(session.phoneNumber),
    callSid,
    reason,
    issueType: session.issueType,
    orderId: session.orderId,
  });

  // Cria task no Flex (via REST interno)
  try {
    const baseUrl = config.baseUrl;
    await fetch(`${baseUrl}/api/flex/escalate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'whatsapp_call',
        phoneNumber: session.phoneNumber,
        authStatus: session.authStatus,
        authChannel: session.authChannel,
        authAttempts: session.authAttempts,
        orderId: session.orderId,
        issueType: session.issueType,
        handoffReason: reason,
        summary: buildSummary({
          channel: 'whatsapp_call',
          phoneNumber: session.phoneNumber,
          authStatus: session.authStatus,
          authChannel: session.authChannel,
          authAttempts: session.authAttempts,
          orderId: session.orderId,
          issueType: session.issueType as IssueType | undefined,
          postAuthTurns: session.postAuthTurns,
          misunderstandCount: session.misunderstandCount,
          handoffReason: reason,
        }),
        nextBestAction: buildNextBestAction({
          channel: 'whatsapp_call',
          phoneNumber: session.phoneNumber,
          authStatus: session.authStatus,
          authChannel: session.authChannel,
          authAttempts: session.authAttempts,
          orderId: session.orderId,
          issueType: session.issueType as IssueType | undefined,
          postAuthTurns: session.postAuthTurns,
          misunderstandCount: session.misunderstandCount,
          handoffReason: reason,
        }),
      }),
    });
  } catch (err) {
    logger.error('escalate_flex_call_error', { error: String(err) });
  }

  // Redireciona chamada para Flex (após 2s para TTS terminar)
  setTimeout(async () => {
    if (config.twilio.flexWorkflowSid) {
      await redirectCallToFlex(callSid, session);
    } else {
      // Sem Flex configurado: apenas encerra
      endCall(ws);
    }
    deleteSession(callSid);
  }, 2500);
}

// ── WebSocket Server ──────────────────────────────────────────────────────────

export function createConversationRelayWss(path: string): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, path });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let callSid = '';

    logger.info('ws_connected', { ip: req.socket.remoteAddress });

    ws.on('message', async (data: WebSocket.RawData) => {
      let event: InboundEvent;

      try {
        event = JSON.parse(data.toString()) as InboundEvent;
      } catch {
        logger.warn('ws_parse_error', { data: data.toString().slice(0, 100) });
        return;
      }

      // ── setup: inicializa sessão ────────────────────────────────────────────
      if (event.type === 'setup') {
        callSid = event.callSid;
        const phone = event.from;

        const session = createSession(callSid, phone);
        logger.info('voice_session_created', {
          callSid,
          phone: maskPhone(phone),
        });

        // Saudação imediata
        speak(ws,
          'Oi. Reconheci este número como cadastrado. ' +
          'Antes de acessar seus pedidos, vou validar sua identidade rapidinho. ' +
          'Quer receber o código por WhatsApp ou por SMS?'
        );
        updateSession(callSid, { state: 'CHOOSING_AUTH_CHANNEL' });
        return;
      }

      // ── prompt: fala do usuário ────────────────────────────────────────────
      if (event.type === 'prompt') {
        if (!event.last) return; // aguarda utterância completa
        const session = getSession(callSid);
        if (!session) {
          logger.warn('ws_no_session', { callSid });
          speak(ws, 'Desculpe, houve um erro. Por favor, ligue novamente.');
          endCall(ws);
          return;
        }
        await handlePrompt(ws, session, event.voicePrompt ?? '');
        return;
      }

      // ── dtmf: tecla pressionada ────────────────────────────────────────────
      if (event.type === 'dtmf') {
        const session = getSession(callSid);
        if (!session) return;
        // Trata DTMF como se fosse fala do dígito
        await handlePrompt(ws, session, event.digits);
        return;
      }

      // ── interrupt: usuário interrompeu ────────────────────────────────────
      if (event.type === 'interrupt') {
        // ConversationRelay cuida de parar o TTS; apenas logamos
        logger.debug('ws_interrupt', { callSid });
        return;
      }
    });

    ws.on('close', (code, reason) => {
      if (callSid) {
        deleteSession(callSid);
        logger.info('ws_closed', { callSid, code, reason: reason.toString() });
      }
    });

    ws.on('error', (err) => {
      logger.error('ws_error', { callSid, error: err.message });
    });
  });

  return wss;
}
