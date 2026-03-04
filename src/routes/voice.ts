import { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../logger';

const router = Router();

/**
 * POST /voice/inbound
 *
 * Webhook chamado pelo Twilio quando uma chamada de voz chega.
 * Retorna TwiML com <Connect><ConversationRelay> apontando para o WebSocket do backend.
 */
router.post('/voice/inbound', (req: Request, res: Response) => {
  const callSid = req.body?.CallSid ?? 'unknown';
  const from = req.body?.From ?? 'unknown';

  logger.info('voice_inbound', {
    callSid,
    from: String(from).slice(-4),
    to: String(req.body?.To ?? '').slice(-4),
  });

  const wsUrl = config.wsPublicUrl;

  // TwiML — ConversationRelay (ElevenLabs PT-BR)
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      dtmfDetection="true"
      interruptByDtmf="true"
      language="pt-BR"
      transcriptionProvider="deepgram"
      speechModel="nova-2"
      ttsProvider="ElevenLabs"
      voice="mPDAoQyGzxBSkE0OAOKw-1.2_0.6_0.8"
      elevenlabsTextNormalization="true"
    />
  </Connect>
</Response>`;

  res.type('text/xml').send(twiml);
});

export default router;