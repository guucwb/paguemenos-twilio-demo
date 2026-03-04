import { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../logger';

const router = Router();

/**
 * POST /voice/inbound
 *
 * Webhook chamado pelo Twilio quando uma chamada de voz chega no número WhatsApp.
 * Retorna TwiML com <Connect><ConversationRelay> apontando para o WebSocket do backend.
 *
 * Configurar no Console Twilio:
 *   Voice Configuration > A Call Comes In > Webhook > POST https://SEU_DOMINIO/voice/inbound
 */
router.post('/voice/inbound', (req: Request, res: Response) => {
  const callSid = req.body?.CallSid ?? 'unknown';
  const from = req.body?.From ?? 'unknown';

  logger.info('voice_inbound', {
    callSid,
    from: from.slice(-4), // apenas últimos 4 para log
    to: (req.body?.To ?? '').slice(-4),
  });

  const wsUrl = config.wsPublicUrl;

  // TwiML — ConversationRelay
  // voice: Voz Polly em PT-BR (disponível com plano Pay-as-you-go)
  // dtmfDetection: permite entrada numérica (1/2/código)
  // interruptByDtmf: usuário pode interromper com tecla
  // transcriptionProvider: deepgram recomendado para PT-BR
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      dtmfDetection="true"
      interruptByDtmf="true"
      voice="Polly.Vitoria-Neural"
      language="pt-BR"
      transcriptionProvider="deepgram"
      speechModel="nova-2"
      ttsProvider="amazon"
    />
  </Connect>
</Response>`;

  res.type('text/xml').send(twiml);
});

export default router;
