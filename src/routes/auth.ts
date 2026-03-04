import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../config';
import { logger, maskPhone } from '../logger';

const router = Router();

function getTwilioClient() {
  return twilio(config.twilio.accountSid, config.twilio.authToken);
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
        to: phoneNumber,
        channel,
      });

    logger.info('started_auth', {
      phone: maskPhone(phoneNumber),
      channel,
      status: verification.status,
    });

    return res.json({ status: verification.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('auth_start_error', { phone: maskPhone(phoneNumber), error: message });
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
        to: phoneNumber,
        code,
      });

    const approved = check.status === 'approved';

    if (approved) {
      logger.info('auth_approved', { phone: maskPhone(phoneNumber) });
    } else {
      logger.warn('auth_failed_check', { phone: maskPhone(phoneNumber), status: check.status });
    }

    return res.json({ approved, status: check.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('auth_check_error', { phone: maskPhone(phoneNumber), error: message });
    // Twilio retorna erro 60202 se o código já foi usado/expirado
    return res.status(500).json({ error: 'Erro ao verificar código', detail: message });
  }
});

export default router;
