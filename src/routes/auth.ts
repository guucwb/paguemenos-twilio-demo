import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../config';
import { logger, maskPhone } from '../logger';

const router = Router();

function getTwilioClient() {
  return twilio(config.twilio.accountSid, config.twilio.authToken);
}

/**
 * Normaliza telefone para E.164 puro.
 * Aceita entradas como:
 * - "whatsapp:+554191039019"
 * - "*whatsapp:+554191039019*"
 * - "+55 41 9103-9019"
 * - "whatsapp:+55 41 9103-9019"
 */
function normalizeToE164(input: unknown): string {
  const raw = String(input ?? '').trim();

  // Remove wrappers comuns vindos de logs/Studio e prefixo whatsapp:
  // ex: "*whatsapp:+55...*: 123" ou "*whatsapp:+55...*"
  const noPrefix = raw
    .replace(/^\*?whatsapp:/i, '')
    .replace(/^\*?whatsapp:/i, '') // dupla chamada defensiva (não custa)
    .trim();

  // Se vier como "*...*: algo", pega só a parte antes dos dois pontos
  const beforeColon = noPrefix.includes(':') ? noPrefix.split(':')[0].trim() : noPrefix;

  // Remove asteriscos e tudo que não seja dígito ou "+"
  const cleaned = beforeColon.replace(/\*/g, '').replace(/[^\d+]/g, '');

  // Garantir que começa com +
  if (!cleaned.startsWith('+')) return `+${cleaned.replace(/^\+*/, '')}`;

  return cleaned;
}

/**
 * POST /api/auth/start
 * Body: { phoneNumber: string, channel: "whatsapp" | "sms" }
 *
 * Inicia uma verificação Twilio Verify para o número informado.
 */
router.post('/api/auth/start', async (req: Request, res: Response) => {
  const { phoneNumber, channel } = req.body as {
    phoneNumber?: string;
    channel?: 'whatsapp' | 'sms';
  };

  if (!phoneNumber || !channel) {
    return res.status(400).json({ error: 'phoneNumber e channel são obrigatórios' });
  }

  if (!['whatsapp', 'sms'].includes(channel)) {
    return res.status(400).json({ error: 'channel deve ser "whatsapp" ou "sms"' });
  }

  const cleanPhone = normalizeToE164(phoneNumber);

  // Verificação básica: + e pelo menos 10 dígitos
  if (!/^\+\d{10,15}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'phoneNumber inválido', detail: cleanPhone });
  }

  const serviceId = config.twilio.verifyServiceSid;
  if (!serviceId) {
    logger.warn('verify_service_sid_missing');
    return res.status(503).json({ error: 'Verify Service não configurado' });
  }

  try {
    const client = getTwilioClient();
    const verification = await client.verify.v2
      .services(serviceId)
      .verifications.create({
        to: cleanPhone, // Verify exige E.164 puro (não aceita "whatsapp:+")
        channel,
      });

    logger.info('started_auth', {
      phone: maskPhone(cleanPhone),
      channel,
      status: verification.status,
    });

    return res.json({ status: verification.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('auth_start_error', { phone: maskPhone(cleanPhone), channel, error: message });
    return res.status(500).json({ error: 'Erro ao iniciar verificação', detail: message });
  }
});

/**
 * POST /api/auth/check
 * Body: { phoneNumber: string, code: string }
 *
 * Verifica o código OTP enviado ao usuário.
 * Retorna { approved: boolean }.
 */
router.post('/api/auth/check', async (req: Request, res: Response) => {
  const { phoneNumber, code } = req.body as {
    phoneNumber?: string;
    code?: string;
  };

  if (!phoneNumber || !code) {
    return res.status(400).json({ error: 'phoneNumber e code são obrigatórios' });
  }

  const cleanPhone = normalizeToE164(phoneNumber);

  // Extrai os 6 dígitos finais (funciona mesmo se vier "123 456" ou texto)
  const cleanCode = String(code).replace(/\D/g, '').slice(-6);

  if (!/^\+\d{10,15}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'phoneNumber inválido', detail: cleanPhone });
  }

  if (cleanCode.length !== 6) {
    return res.status(400).json({ error: 'Código OTP inválido' });
  }

  const serviceId = config.twilio.verifyServiceSid;
  if (!serviceId) {
    logger.warn('verify_service_sid_missing');
    return res.status(503).json({ error: 'Verify Service não configurado' });
  }

  try {
    const client = getTwilioClient();
    const check = await client.verify.v2
      .services(serviceId)
      .verificationChecks.create({
        to: cleanPhone,
        code: cleanCode,
      });

    const approved = check.status === 'approved';

    if (approved) {
      logger.info('auth_approved', { phone: maskPhone(cleanPhone) });
    } else {
      logger.warn('auth_failed_check', { phone: maskPhone(cleanPhone), status: check.status });
    }

    return res.json({ approved, status: check.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('auth_check_error', { phone: maskPhone(cleanPhone), error: message });
    return res.status(500).json({ error: 'Erro ao verificar código', detail: message });
  }
});

export default router;