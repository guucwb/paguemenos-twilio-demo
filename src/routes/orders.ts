import { Router, Request, Response } from 'express';
import {
  getLastOrderByPhone,
  getOrderById,
  findCustomerByPhone,
} from '../data/store';
import { logger, maskPhone } from '../logger';

const router = Router();

/**
 * GET /api/orders/last?phone=+5511...
 *
 * Retorna o pedido mais recente (e ativo) do cliente.
 * Reutilizado por voz (ConversationRelay) e Studio (HTTP Request).
 */
router.get('/api/orders/last', (req: Request, res: Response) => {
  const phone = req.query.phone as string;

  if (!phone) {
    return res.status(400).json({ error: 'Parâmetro phone é obrigatório' });
  }

  const customer = findCustomerByPhone(phone);
  if (!customer) {
    logger.warn('customer_not_found', { phone: maskPhone(phone) });
    return res.status(404).json({ notFound: true, message: 'Cliente não encontrado' });
  }

  const order = getLastOrderByPhone(phone);
  if (!order) {
    logger.info('no_orders_found', { phone: maskPhone(phone) });
    return res.status(404).json({ notFound: true, message: 'Nenhum pedido encontrado' });
  }

  logger.info('last_order_presented', {
    phone: maskPhone(phone),
    orderId: order.id,
    status: order.status,
    confidence: order.confidence,
  });

  return res.json({
    orderId: order.id,
    itemSummary: order.itemSummary,
    status: order.status,
    statusLabel: order.statusLabel,
    eta: order.eta,
    confidence: order.confidence,
    customerName: customer.name,
  });
});

/**
 * GET /api/orders/by-id?phone=+5511...&order=ORD-001
 *
 * Retorna pedido específico por ID + validação do telefone do dono.
 */
router.get('/api/orders/by-id', (req: Request, res: Response) => {
  const phone = req.query.phone as string;
  const orderId = req.query.order as string;

  if (!phone || !orderId) {
    return res.status(400).json({ error: 'Parâmetros phone e order são obrigatórios' });
  }

  const order = getOrderById(orderId, phone);
  if (!order) {
    return res.status(404).json({
      notFound: true,
      message: `Pedido ${orderId} não encontrado para este número`,
    });
  }

  logger.info('order_by_id_presented', {
    phone: maskPhone(phone),
    orderId: order.id,
    status: order.status,
  });

  return res.json({
    orderId: order.id,
    itemSummary: order.itemSummary,
    status: order.status,
    statusLabel: order.statusLabel,
    eta: order.eta,
    confidence: order.confidence,
  });
});

export default router;
