import { Router, Request, Response } from 'express';
import { config } from '../config';
import { getAllSessions, getSession, findSessionByLast4 } from '../core/sessionManager';
import { findCustomerByPhone, getAllCustomers, getAllOrders, reloadStore } from '../data/store';
import { maskPhone } from '../logger';

const router = Router();

// Bloqueia em produção (opcional — remova se quiser inspecionar em staging)
function devOnly(_req: Request, res: Response, next: () => void): void {
  if (!config.isDev) {
    res.status(403).json({ error: 'Disponível apenas em ambiente de desenvolvimento' });
    return;
  }
  next();
}

/**
 * GET /debug/sessions — lista todas as sessões de voz ativas
 */
router.get('/debug/sessions', devOnly, (_req: Request, res: Response) => {
  const sessions = getAllSessions().map(s => ({
    callSid: s.callSid,
    phone: maskPhone(s.phoneNumber),
    state: s.state,
    authStatus: s.authStatus,
    postAuthTurns: s.postAuthTurns,
    escalated: s.escalated,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
  res.json({ count: sessions.length, sessions });
});

/**
 * GET /debug/session/:callSid — detalhes de uma sessão (mascarado)
 */
router.get('/debug/session/:callSid', devOnly, (req: Request, res: Response) => {
  const session = getSession(req.params.callSid);
  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }
  return res.json({
    ...session,
    phoneNumber: maskPhone(session.phoneNumber),
  });
});

/**
 * GET /debug/customer/:last4 — busca cliente por últimos 4 dígitos do telefone
 */
router.get('/debug/customer/:last4', devOnly, (req: Request, res: Response) => {
  const { last4 } = req.params;
  if (!/^\d{4}$/.test(last4)) {
    return res.status(400).json({ error: 'Informe exatamente 4 dígitos' });
  }

  const customers = getAllCustomers();
  const found = customers.filter(c => c.phoneNumber.replace(/\D/g, '').slice(-4) === last4);

  if (found.length === 0) {
    return res.status(404).json({ error: 'Nenhum cliente encontrado' });
  }

  return res.json(
    found.map(c => ({
      id: c.id,
      phone: maskPhone(c.phoneNumber),
      name: c.name.split(' ')[0] + ' ***', // primeiro nome + asteriscos
    }))
  );
});

/**
 * GET /debug/session-by-phone/:last4 — busca sessão de voz por últimos 4 dígitos
 */
router.get('/debug/session-by-phone/:last4', devOnly, (req: Request, res: Response) => {
  const session = findSessionByLast4(req.params.last4);
  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }
  return res.json({
    ...session,
    phoneNumber: maskPhone(session.phoneNumber),
  });
});

/**
 * POST /debug/reload-store — recarrega customers.json e orders.json sem restart
 */
router.post('/debug/reload-store', devOnly, (_req: Request, res: Response) => {
  reloadStore();
  res.json({ ok: true, message: 'Store recarregada' });
});

/**
 * GET /debug/data — lista dados do store (mascarado)
 */
router.get('/debug/data', devOnly, (_req: Request, res: Response) => {
  const customers = getAllCustomers().map(c => ({
    id: c.id,
    phone: maskPhone(c.phoneNumber),
    name: c.name.split(' ')[0] + ' ***',
  }));
  const orders = getAllOrders().map(o => ({
    id: o.id,
    phone: maskPhone(o.phoneNumber),
    status: o.status,
    confidence: o.confidence,
    eta: o.eta,
  }));
  res.json({ customers, orders });
});

export default router;
