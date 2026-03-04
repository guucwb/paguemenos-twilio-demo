import { maskPhone } from '../logger';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type IssueType = 'delay' | 'missing_item' | 'wrong_address' | 'billing' | 'repeat_order' | 'other';

export interface EscalationContext {
  channel: 'whatsapp_call' | 'whatsapp_text';
  phoneNumber: string;
  authStatus: 'pending' | 'approved' | 'failed';
  authAttempts: number;
  authChannel: 'whatsapp' | 'sms';
  orderId?: string;
  issueType?: IssueType;
  postAuthTurns: number;
  misunderstandCount: number;
  userRequestedHuman?: boolean;
  urgencyDetected?: boolean;
  handoffReason?: string;
}

export interface ResolveResult {
  resolved: boolean;
  message: string;
  action: string;
  shouldEscalate?: boolean;
}

export interface EscalationDecision {
  escalate: boolean;
  reason?: string;
}

// ── Palavras de urgência/negatividade ────────────────────────────────────────

const URGENCY_WORDS = [
  'procon', 'agora', 'absurdo', 'reclamação', 'processar', 'urgente',
  'inadmissível', 'ridículo', 'absurdo', 'enganado', 'fraude', 'cancelar',
  'desistir', 'roubo', 'péssimo', 'horrível',
];

const HUMAN_REQUEST_WORDS = [
  'atendente', 'humano', 'pessoa', 'falar com alguém', 'quero humano',
  'operador', 'agente', 'pessoa real', 'falar com pessoa',
];

// ── Funções principais ────────────────────────────────────────────────────────

export function shouldRequireAuth(intent: string): boolean {
  const authRequired = ['order_status', 'repeat_order', 'order_issue', 'billing', 'last_order'];
  return authRequired.includes(intent);
}

export function detectUrgency(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return URGENCY_WORDS.some(w => lower.includes(w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
}

export function detectHumanRequest(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return HUMAN_REQUEST_WORDS.some(w => lower.includes(w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
}

export function detectIssueType(text: string): IssueType | null {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (/cobran|pagamento|fatura|debito|cartao|cobrança|preco/.test(lower)) return 'billing';
  if (/atraso|atrasado|demorou|demora|nao chegou|nao veio|onde esta|onde fica/.test(lower)) return 'delay';
  if (/faltou|faltando|incompleto|errado|diferente|nao veio|item|produto/.test(lower)) return 'missing_item';
  if (/endereco|endereço|entregar|entrega|CEP|logradouro|mudar endereco/.test(lower)) return 'wrong_address';
  if (/repetir|de novo|mesma compra|igual|mesmo pedido/.test(lower)) return 'repeat_order';

  return null;
}

export function shouldEscalate(ctx: EscalationContext): EscalationDecision {
  if (ctx.userRequestedHuman) return { escalate: true, reason: 'user_request' };
  if (ctx.authStatus === 'failed') return { escalate: true, reason: 'auth_failed' };
  if (ctx.issueType === 'billing') return { escalate: true, reason: 'billing_issue' };
  if (ctx.misunderstandCount >= 2) return { escalate: true, reason: 'max_misunderstandings' };
  if (ctx.postAuthTurns >= 3) return { escalate: true, reason: 'max_turns' };
  if (ctx.urgencyDetected) return { escalate: true, reason: 'urgency_detected' };

  return { escalate: false };
}

export function resolveIssue(issueType: IssueType, orderId: string): ResolveResult {
  switch (issueType) {
    case 'delay':
      return {
        resolved: true,
        message: `Seu pedido #${orderId} está em rota de entrega. Atualizamos a previsão para hoje até às 18h. Você receberá uma notificação assim que o entregador sair.`,
        action: 'eta_updated',
      };

    case 'missing_item':
      return {
        resolved: true,
        message: `Registramos a divergência no pedido #${orderId}. Em até 2 dias úteis você receberá o item faltante ou um reembolso integral. O número do protocolo é #P-${orderId}-MIS.`,
        action: 'missing_item_registered',
      };

    case 'wrong_address':
      return {
        resolved: false,
        message: `Para alterar o endereço de entrega do pedido #${orderId} precisamos verificar alguns dados com segurança. Vou te passar para um atendente agora.`,
        action: 'escalate',
        shouldEscalate: true,
      };

    case 'repeat_order':
      return {
        resolved: true,
        message: `Registramos a solicitação de repetição do pedido #${orderId}. Você receberá uma confirmação por WhatsApp com o novo pedido em até 30 minutos.`,
        action: 'repeat_order_requested',
      };

    case 'billing':
      return {
        resolved: false,
        message: `Questões de cobrança são tratadas pela nossa equipe financeira especializada. Vou te transferir agora com todas as informações do seu caso.`,
        action: 'escalate',
        shouldEscalate: true,
      };

    default:
      return {
        resolved: false,
        message: `Não consegui identificar exatamente o problema. Para te ajudar melhor, vou te conectar com um atendente que já terá todas as informações do seu caso.`,
        action: 'escalate',
        shouldEscalate: true,
      };
  }
}

export function buildSummary(ctx: EscalationContext): string {
  const parts = [
    `Canal: ${ctx.channel}`,
    `Telefone: ${maskPhone(ctx.phoneNumber)}`,
    `Auth: ${ctx.authStatus} (${ctx.authAttempts} tentativa(s) via ${ctx.authChannel})`,
    ctx.orderId ? `Pedido: #${ctx.orderId}` : 'Pedido: não informado',
    ctx.issueType ? `Problema: ${ctx.issueType}` : 'Problema: não classificado',
    ctx.userRequestedHuman ? 'Cliente pediu humano: SIM' : '',
    ctx.urgencyDetected ? 'Urgência detectada: SIM' : '',
  ].filter(Boolean);

  return parts.join(' | ');
}

export function buildNextBestAction(ctx: EscalationContext): string {
  if (ctx.handoffReason === 'auth_failed') return 'Verificar identidade do cliente manualmente antes de acessar o pedido';
  if (ctx.issueType === 'billing') return 'Verificar cobranças no sistema financeiro e confirmar valores com o cliente';
  if (ctx.issueType === 'delay') return 'Verificar status de entrega no sistema logístico e fornecer nova previsão';
  if (ctx.issueType === 'missing_item') return 'Verificar separação do pedido e processar reenvio ou reembolso';
  if (ctx.issueType === 'wrong_address') return 'Confirmar dados do cliente e atualizar endereço de entrega no sistema';
  if (ctx.userRequestedHuman) return 'Entender necessidade do cliente — preferiu falar com pessoa';
  return 'Entender necessidade do cliente e resolver';
}
