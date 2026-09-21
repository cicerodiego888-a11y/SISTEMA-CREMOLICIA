/**
 * Testes dos helpers de API do Motor Comercial.
 */

const { unwrapData, unwrapUseCaseData } = require('../../api/helpers');

describe('api/helpers', () => {
  describe('unwrapUseCaseData', () => {
    it('extrai perfil de StandardResponse de criação', () => {
      const response = {
        success: true,
        data: {
          perfil: { id: 5, clienteId: 10, perfilTipo: 'CONSIGNADO' },
          correlationId: 'corr-1'
        }
      };
      const perfil = unwrapUseCaseData(response);
      expect(perfil).toEqual({ id: 5, clienteId: 10, perfilTipo: 'CONSIGNADO' });
    });

    it('extrai consignacao de StandardResponse', () => {
      const response = {
        success: true,
        data: {
          consignacao: { id: 99, clienteId: 10 },
          correlationId: 'corr-2'
        }
      };
      expect(unwrapUseCaseData(response)).toEqual({ id: 99, clienteId: 10 });
    });

    it('RCM-8.13.4 — preserva payload composto com comprovante (Prestação/Complementar)', () => {
      const payload = {
        consignacao: { id: 21, documento: { numero: 'CONS-2026-000021' } },
        correlationId: 'corr-comp-004',
        idempotente: false,
        entregas: [{ correlationId: 'corr-comp-004', numeroComprovante: '004' }],
        comprovante: {
          numeroComprovante: '004',
          tipo: 'COMPLEMENTAR',
          listaCompleta: [{ produtoNome: 'PICOLE', quantidade: 10 }],
          atualizacao: { tipo: 'ENTREGA COMPLEMENTAR' }
        }
      };
      const response = { success: true, data: payload };
      const out = unwrapUseCaseData(response);
      expect(out.comprovante.numeroComprovante).toBe('004');
      expect(out.correlationId).toBe('corr-comp-004');
      expect(out.consignacao.id).toBe(21);
      expect(out.entregas).toHaveLength(1);
    });
  });

  describe('unwrapData', () => {
    it('lança erro quando success é false', () => {
      expect(() => unwrapData({ success: false, error: { message: 'Erro' } })).toThrow('Erro');
    });
  });
});
