import { IssueType } from './engine';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type ConversationState =
  | 'GREETING'
  | 'CHOOSING_AUTH_CHANNEL'
  | 'WAITING_CODE'
  | 'AUTHENTICATED'
  | 'ORDER_PRESENTED'
  | 'WAITING_ORDER_ID'
  | 'IDENTIFYING_ISSUE'
  | 'RESOLVING'
  | 'ESCALATING'
  | 'DONE';

export interface VoiceSession {
  callSid: string;
  phoneNumber: string;
  state: ConversationState;
  authStatus: 'pending' | 'approved' | 'failed';
  authAttempts: number;
  authChannel: 'whatsapp' | 'sms';
  orderId?: string;
  orderData?: Record<string, unknown>;
  issueType?: IssueType;
  postAuthTurns: number;
  misunderstandCount: number;
  userRequestedHuman: boolean;
  urgencyDetected: boolean;
  escalated: boolean;
  handoffReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Store em memória ──────────────────────────────────────────────────────────
// Para produção de longo prazo: substituir por Redis.
// Para demo: in-memory é suficiente (sessão de voz dura minutos).

const sessions = new Map<string, VoiceSession>();

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hora

// Limpeza periódica de sessões antigas (roda a cada 15 min)
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.updatedAt.getTime() > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}, 15 * 60 * 1000);

// ── API ───────────────────────────────────────────────────────────────────────

export function createSession(callSid: string, phoneNumber: string): VoiceSession {
  const session: VoiceSession = {
    callSid,
    phoneNumber,
    state: 'GREETING',
    authStatus: 'pending',
    authAttempts: 0,
    authChannel: 'whatsapp',
    postAuthTurns: 0,
    misunderstandCount: 0,
    userRequestedHuman: false,
    urgencyDetected: false,
    escalated: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  sessions.set(callSid, session);
  return session;
}

export function getSession(callSid: string): VoiceSession | undefined {
  return sessions.get(callSid);
}

export function updateSession(callSid: string, patch: Partial<VoiceSession>): VoiceSession {
  const existing = sessions.get(callSid);
  if (!existing) throw new Error(`Session not found: ${callSid}`);

  const updated: VoiceSession = {
    ...existing,
    ...patch,
    updatedAt: new Date(),
  };
  sessions.set(callSid, updated);
  return updated;
}

export function deleteSession(callSid: string): void {
  sessions.delete(callSid);
}

export function getAllSessions(): VoiceSession[] {
  return Array.from(sessions.values());
}

/** Busca sessão por últimos 4 dígitos do telefone (para debug) */
export function findSessionByLast4(last4: string): VoiceSession | undefined {
  for (const session of sessions.values()) {
    if (session.phoneNumber.slice(-4) === last4) {
      return session;
    }
  }
  return undefined;
}
