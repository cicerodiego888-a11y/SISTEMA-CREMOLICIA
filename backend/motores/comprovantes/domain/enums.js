/**
 * Enums do Motor de Comprovantes (RCM-04.4).
 */

const TIPOS_COMPROVANTE = Object.freeze({
  ENTREGA: 'ENTREGA',
  PRESTACAO: 'PRESTACAO',
  VENDA: 'VENDA',
  PEDIDO: 'PEDIDO',
  ORCAMENTO: 'ORCAMENTO',
  COMPRA: 'COMPRA',
  DEVOLUCAO: 'DEVOLUCAO'
});

const ACOES_AUDITORIA = Object.freeze({
  VISUALIZACAO: 'visualizacao',
  RESUMO_COPIADO: 'resumo_copiado',
  WHATSAPP: 'whatsapp',
  PDF: 'pdf',
  IMPRESSAO: 'impressao',
  EMAIL: 'email',
  LINK: 'link'
});

const STATUS_CREDITO = Object.freeze({
  VERDE: 'VERDE',
  AMARELO: 'AMARELO',
  VERMELHO: 'VERMELHO'
});

const MOTOR_COMPROVANTES_VERSAO = '1.0.0';

module.exports = {
  TIPOS_COMPROVANTE,
  ACOES_AUDITORIA,
  STATUS_CREDITO,
  MOTOR_COMPROVANTES_VERSAO
};
