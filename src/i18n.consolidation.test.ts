import { describe, expect, it } from 'vitest';

import { LANGUAGES, type LanguageCode } from './i18n';
import { makeConsolidationTranslator } from './i18n.consolidation';

describe('consolidation translations', () => {
  it('says that every remaining partial-send transaction can be reviewed and sent', () => {
    const expected = {
      en: 'Some transactions were sent. The remaining transactions are ready to review and send.',
      zh: '部分交易已发送，其余交易仍可查看并发送。',
      de: 'Ein Teil der Transaktionen wurde gesendet. Die übrigen können geprüft und gesendet werden.',
      es: 'Se enviaron algunas transacciones. Las restantes están listas para revisar y enviar.',
      fr: 'Certaines transactions ont été envoyées. Les autres restent prêtes à être vérifiées et envoyées.',
      ja: '一部のトランザクションを送信しました。残りは引き続き確認して送信できます。',
      tr: 'İşlemlerin bir kısmı gönderildi. Kalanlar incelenmeye ve gönderilmeye hazır.',
      pt: 'Algumas transações foram enviadas. As restantes continuam prontas para revisão e envio.',
      ru: 'Часть транзакций отправлена. Остальные готовы к проверке и отправке.',
    } satisfies Record<LanguageCode, string>;

    for (const { code } of LANGUAGES) {
      const message = makeConsolidationTranslator(code)('partialBody');
      expect(message).toBe(expected[code]);
      expect(message).not.toContain('確認待ち');
    }
  });
});
