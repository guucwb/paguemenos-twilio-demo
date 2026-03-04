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
  // Pode vir como "digit" ou "digits" dependendo da versão
  digit?: string;
  digits?: string;
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
  // Mantém o formato que já funcionou no seu ambiente
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

/** Detecta escolha 1 ou 2 */
function parseChoice12(input: string): '1' | '2' | null {
  const cleanDigits = input.trim().replace(/\D/g, '');
  if (cleanDigits === '1') return '1';
  if (cleanDigits === '2') return '2';
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
  if (!resp.ok) throw new Error(`auth_start_http_${resp.status}`);
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
  if (!resp.ok) throw new Error(`auth_check_http_${resp.status}`);
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
        speak(
          ws,
          `Ok, enviei o código por ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}. ` +
            `Agora, por favor, digite os 6 números no teclado do seu telefone.`
        );
        updateSession(callSid, { state: 'WAITING_CODE', dtmfBuffer: '' });
      } catch {
        speak(ws, 'Tive um problema ao enviar o código. Quer tentar receber por SMS? Diga "SMS" ou "WhatsApp".');
      }
      break;
    }

    case 'WAITING_CODE': {
      // Preferência total: DTMF (vem 1 dígito por evento). Se vier fala com 6 dígitos, também funciona.
      const digitsOnly = input.replace(/\D/g, '');

      // acumula até 6
      const next = (session.dtmfBuffer + digitsOnly).slice(0, 6);
      updateSession(callSid, { dtmfBuffer: next });

      if (next.length < 6) {
        speak(ws, `Ok. Recebi ${next.length}. Digite os ${6 - next.length} números restantes.`);
        return;
      }

      const code = next;
      updateSession(callSid, { dtmfBuffer: '' });

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
        updateSession(callSid, {
          authAttempts: attempts,
          authStatus: attempts >= 2 ? 'failed' : 'pending',
        });

        if (attempts >= 2) {
          logger.warn('auth_failed', { phone: maskPhone(phone), attempts });
          speak(ws, 'O código não confere por duas vezes. Por segurança, vou te transferir para um atendente.');
          await doEscalate(ws, callSid, 'auth_failed');
        } else {
          speak(ws, 'Código incorreto. Digite novamente os 6 dígitos no teclado.');
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
        speak(
          ws,
          `Não encontrei o pedido ${orderId} associado a este número. ` +
            `Verifique o número e tente de novo, ou diga "atendente" para falar com alguém.`
        );
        return;
      }

      updateSession(callSid, {
        orderId: order.id,
        orderData: order as unknown as Record<string, unknown>,
        state: 'IDENTIFYING_ISSUE',
      });

      speak(
        ws,
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
          speak(
            ws,
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

      const orderId = session.orderId ?? (getLastOrderByPhone(phone)?.id ?? 'N/A');
      updateSession(callSid, { issueType: issue, orderId, state: 'RESOLVING' });

      const result = resolveIssue(issue, orderId);

      if (result.shouldEscalate || !result.resolved) {
        speak(ws, result.message);
        await doEscalate(ws, callSid, result.action);
      } else {
        logger.info('resolved', { phone: maskPhone(phone), orderId, issue, action: result.action });
        speak(ws, `${result.message} Posso ajudar com mais alguma coisa?`);
        updateSession(callSid, { state: 'DONE' });

        setTimeout(() => {
          endCall(ws);
          deleteSession(callSid);
        }, 8000);
      }
      break;
    }

    case 'DONE':
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
    speak(
      ws,
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

  const prefix = order.confidence === 'low' ? 'Posso estar vendo um pedido mais antigo. ' : '';

  speak(
    ws,
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

  speak(ws, 'Vou te transferir para um atendente agora e já vou mandar um resumo pra você não precisar repetir. Um momento.');

  logger.info('escalated', {
    phone: maskPhone(session.phoneNumber),
    callSid,
    reason,
    issueType: session.issueType,
    orderId: session.orderId,
  });

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

  setTimeout(async () => {
    if (config.twilio.flexWorkflowSid) {
      await redirectCallToFlex(callSid, session);
    } else {
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

      if (event.type === 'setup') {
        callSid = event.callSid;
        const phone = event.from;

        const session = createSession(callSid, phone);

        logger.info('voice_session_created', {
          callSid,
          phone: maskPhone(phone),
        });

        speak(
          ws,
          'Oi. Reconheci este número como cadastrado. ' +
            'Antes de acessar seus pedidos, vou validar sua identidade rapidinho. ' +
            'Quer receber o código por WhatsApp ou por SMS?'
        );

        updateSession(callSid, { state: 'CHOOSING_AUTH_CHANNEL' });
        return;
      }

      if (event.type === 'prompt') {
        const isLast = (event as any).last;
        if (isLast === false) return;

        const session = getSession(callSid);
        if (!session) {
          logger.warn('ws_no_session', { callSid });
          speak(ws, 'Desculpe, houve um erro. Por favor, ligue novamente.');
          endCall(ws);
          return;
        }

        await handlePrompt(ws, session, (event as any).voicePrompt ?? '');
        return;
      }

      if (event.type === 'dtmf') {
        const session = getSession(callSid);
        if (!session) return;

        const digit = String((event as any).digits ?? (event as any).digit ?? '');
        if (!digit) return;

        await handlePrompt(ws, session, digit);
        return;
      }

      if (event.type === 'interrupt') {
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