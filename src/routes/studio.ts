import { Router, Request, Response } from 'express';
import { logger, maskPhone } from '../logger';
import { resolveIssue, detectIssueType, IssueType } from '../core/engine';
import { getLastOrderByPhone, getOrderById } from '../data/store';

const router = Router();

/**
 * POST /studio/resolve
 *
 * Chamado pelo Studio após identificar o problema do cliente.
 * Retorna mensagem de resolução ou instrução de escalate.
 *
 * Body: { phoneNumber, orderId, issueType }
 */
router.post('/studio/resolve', (req: Request, res: Response) => {
  const { phoneNumber, orderId, issueType, rawText } = req.body as {
    phoneNumber?: string;
    orderId?: string;
    issueType?: string;
    rawText?: string;
  };

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber é obrigatório' });
  }

  // Tenta detectar issueType do texto bruto se não fornecido
  let resolvedIssueType: IssueType = (issueType as IssueType) ?? 'other';
  if (!issueType && rawText) {
    resolvedIssueType = detectIssueType(rawText) ?? 'other';
  }

  // Precisa de um orderId para resolver
  let targetOrderId = orderId;
  if (!targetOrderId) {
    const lastOrder = getLastOrderByPhone(phoneNumber);
    targetOrderId = lastOrder?.id ?? 'N/A';
  }

  const result = resolveIssue(resolvedIssueType, targetOrderId);

  logger.info(result.resolved ? 'resolved' : 'resolve_escalate', {
    phone: maskPhone(phoneNumber),
    orderId: targetOrderId,
    issueType: resolvedIssueType,
    action: result.action,
  });

  return res.json({
    resolved: result.resolved,
    message: result.message,
    action: result.action,
    shouldEscalate: result.shouldEscalate ?? false,
    issueType: resolvedIssueType,
    orderId: targetOrderId,
  });
});

/**
 * POST /studio/should-auth
 *
 * Simples verificação se autenticação é necessária para a intenção.
 * Studio chama antes de iniciar o fluxo de Verify.
 *
 * Body: { intent }
 */
router.post('/studio/should-auth', (req: Request, res: Response) => {
  // Por padrão, qualquer acesso a pedidos requer auth
  return res.json({ requiresAuth: true });
});

/**
 * GET /studio/order-message?phone=...
 *
 * Retorna mensagem formatada do último pedido para envio via Studio.
 * O Studio usa {{widgets.get_order.parsed_body.message}} diretamente.
 */
router.get('/studio/order-message', (req: Request, res: Response) => {
  const phone = req.query.phone as string;

  if (!phone) {
    return res.status(400).json({ error: 'phone é obrigatório' });
  }

  const order = getLastOrderByPhone(phone);
  if (!order) {
    return res.json({
      found: false,
      message: 'Não encontrei pedidos recentes associados a este número. Quer tentar com outro número ou falar com um atendente?',
    });
  }

  const prefix = order.confidence === 'low'
    ? '⚠️ Posso estar vendo um pedido mais antigo. '
    : '';

  const message =
    `${prefix}Encontrei um pedido recente:\n\n` +
    `📦 *Pedido #${order.id}*\n` +
    `🛍️ ${order.itemSummary}\n` +
    `📊 Status: ${order.statusLabel}\n` +
    `🕐 Previsão: ${order.eta}\n\n` +
    `É sobre esse pedido?\n*1* - Sim, é esse\n*2* - Não, é outro`;

  return res.json({
    found: true,
    orderId: order.id,
    itemSummary: order.itemSummary,
    status: order.status,
    statusLabel: order.statusLabel,
    eta: order.eta,
    confidence: order.confidence,
    message,
  });
});

/**
 * GET /studio/order-by-id?phone=...&order=ORD-001
 *
 * Busca pedido específico + mensagem formatada.
 */
router.get('/studio/order-by-id', (req: Request, res: Response) => {
  const phone = req.query.phone as string;
  const orderId = req.query.order as string;

  if (!phone || !orderId) {
    return res.status(400).json({ error: 'phone e order são obrigatórios' });
  }

  const order = getOrderById(orderId, phone);
  if (!order) {
    return res.json({
      found: false,
      message: `Não encontrei o pedido *#${orderId}* associado a este número. Confira o número do pedido e tente novamente, ou *3* para falar com um atendente.`,
    });
  }

  const message =
    `Encontrei o pedido *#${order.id}*:\n\n` +
    `🛍️ ${order.itemSummary}\n` +
    `📊 Status: ${order.statusLabel}\n` +
    `🕐 Previsão: ${order.eta}\n\n` +
    `Qual é o problema com esse pedido?\n` +
    `*1* - Atraso na entrega\n` +
    `*2* - Item faltando ou errado\n` +
    `*3* - Questão de cobrança\n` +
    `*4* - Outro / Falar com atendente`;

  return res.json({
    found: true,
    orderId: order.id,
    itemSummary: order.itemSummary,
    status: order.status,
    statusLabel: order.statusLabel,
    eta: order.eta,
    message,
  });
});

export default router;
