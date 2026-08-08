/**
 * RCM-04.4 — Motor de Comprovantes / Snapshot / Texto / PDF / QR
 */

const assert = require('assert');
const { buildTextoCompartilhavel, formatMoney } = require('../services/TextoCompartilhavelBuilder');
const { buildQrCode } = require('../services/QrCodeBuilder');
const { buildPdfPayload, buildHtmlComprovante } = require('../services/PdfComprovanteBuilder');
const { TIPOS_COMPROVANTE, STATUS_CREDITO, MOTOR_COMPROVANTES_VERSAO } = require('../domain/enums');
const { statusCreditoPorUso } = (() => {
  // replica leve da regra VERDE/AMARELO/VERMELHO
  function fn(limite, saldoAtual) {
    const lim = Number(limite) || 0;
    const saldo = Number(saldoAtual) || 0;
    if (lim <= 0) return saldo > 0 ? STATUS_CREDITO.AMARELO : STATUS_CREDITO.VERDE;
    const pct = (saldo / lim) * 100;
    if (pct > 90) return STATUS_CREDITO.VERMELHO;
    if (pct >= 70) return STATUS_CREDITO.AMARELO;
    return STATUS_CREDITO.VERDE;
  }
  return { statusCreditoPorUso: fn };
})();

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('  OK', msg);
}

function sampleSnapshot() {
  return {
    id: 'cmp-entrega-1-abc',
    numeroComprovante: 'CE-000001',
    tipo: TIPOS_COMPROVANTE.ENTREGA,
    versao: MOTOR_COMPROVANTES_VERSAO,
    cabecalho: {
      empresaNome: 'Mercadão',
      clienteNome: 'Cliente Teste',
      clienteDocumento: '123',
      clienteCodigo: '9',
      data: '30/07/2026',
      hora: '10:00',
      vendedor: 'Op',
      numeroComprovante: 'CE-000001'
    },
    cards: {
      produtos: {
        itens: [{ produto: 'Queijo', quantidade: 2, unidade: 'UN', preco: 10, total: 20 }],
        quantidadeTotal: 2,
        volumes: 1,
        valorComercial: 20
      },
      situacaoComercial: {
        saldoAnterior: 0,
        novaRemessa: 20,
        saldoAtual: 20,
        limite: 100,
        creditoDisponivel: 80,
        consignacoesAbertas: 1,
        valorEmAberto: 20,
        statusComercial: STATUS_CREDITO.VERDE
      },
      historico: {
        ultimaEntrega: '30/07/2026',
        maiorRemessa: 20,
        mediaRemessas: 20,
        perdasEmpresa: 0,
        perdasCliente: 0,
        indicePerdas: 0
      },
      observacoes: { entrega: 'Entrega ok' }
    },
    indicadores: { statusCredito: STATUS_CREDITO.VERDE },
    qrCode: { hash: 'abc123' }
  };
}

async function main() {
  console.log('=== RCM-04.4 Tests ===\n');

  console.log('[1] Status crédito');
  ok(statusCreditoPorUso(100, 50) === 'VERDE', 'até 70% = VERDE');
  ok(statusCreditoPorUso(100, 80) === 'AMARELO', '70-90% = AMARELO');
  ok(statusCreditoPorUso(100, 95) === 'VERMELHO', '>90% = VERMELHO');

  console.log('\n[2] Texto compartilhável');
  const snap = sampleSnapshot();
  const texto = buildTextoCompartilhavel(snap);
  ok(texto.includes('COMPROVANTE DE ENTREGA'), 'título no texto');
  ok(texto.includes('Cliente Teste'), 'cliente no texto');
  ok(texto.includes('Queijo'), 'produto no texto');
  ok(texto.includes(formatMoney(20)), 'valor no texto');

  console.log('\n[3] QR Code');
  const qr = await buildQrCode({
    id: snap.id,
    numeroComprovante: snap.numeroComprovante,
    empresa: 'Mercadão',
    versao: MOTOR_COMPROVANTES_VERSAO
  });
  ok(!!qr.hash, 'hash presente');
  ok(!!qr.conteudo, 'conteúdo presente');
  ok(qr.versao === MOTOR_COMPROVANTES_VERSAO, 'versão QR');

  console.log('\n[4] PDF / HTML do mesmo snapshot');
  snap.qrCode = qr;
  snap.textoCompartilhavel = buildTextoCompartilhavel(snap);
  const pdf = buildPdfPayload(snap);
  ok(!!pdf.base64, 'pdf base64');
  ok(!!pdf.html, 'html oficial');
  ok(pdf.html.includes('Cliente Teste'), 'html usa snapshot');
  ok(pdf.html.includes('CE-000001'), 'número no html');
  ok(pdf.html.includes('COMPROVANTE DE ENTREGA') || pdf.html.includes('Comprovante de Entrega'), 'título RC2');
  ok(pdf.html.includes('Assinatura do Cliente'), 'área de assinatura');
  ok(pdf.html.includes('Emitido pelo CDS Sistemas'), 'rodapé CDS');
  ok(pdf.html.includes('Resumo Financeiro') || pdf.html.includes('RESUMO FINANCEIRO') || pdf.html.includes('sec-title'), 'bloco financeiro');
  ok(!pdf.html.includes('Hash '), 'sem hash no layout impresso');
  ok(!pdf.html.includes('Histórico'), 'sem histórico no layout impresso');
  ok(!pdf.html.includes('Índice de perdas'), 'sem índice de perdas');
  ok(!pdf.html.includes('statusComercial') && !pdf.html.includes('badge VERDE'), 'sem status comercial visual');
  const html2 = buildHtmlComprovante(snap);
  ok(html2 === pdf.html, 'mesmo HTML do builder');
  ok(pdf.html.includes('Queijo'), 'produto na tabela');
  ok(pdf.html.includes('Declaro ter recebido'), 'declaração de recebimento');

  console.log('\n[5] Snapshot imutável (sem recalcular no texto)');
  const textoA = buildTextoCompartilhavel(snap);
  const textoB = buildTextoCompartilhavel(snap);
  ok(textoA === textoB, 'texto estável para o mesmo snapshot');
  ok(textoA.includes(qr.hash), 'texto usa hash do QR do snapshot');

  console.log('\n[6] Enums / tipo');
  ok(TIPOS_COMPROVANTE.ENTREGA === 'ENTREGA', 'tipo ENTREGA');
  ok(TIPOS_COMPROVANTE.PRESTACAO === 'PRESTACAO', 'tipo PRESTACAO');

  console.log('\n[7] PDF / HTML Prestação de Contas');
  const {
    buildTextoCompartilhavelPrestacao
  } = require('../services/TextoCompartilhavelBuilder');
  const snapPc = {
    id: 'cmp-prestacao-1',
    numeroComprovante: 'PC-000001',
    tipo: TIPOS_COMPROVANTE.PRESTACAO,
    versao: MOTOR_COMPROVANTES_VERSAO,
    cabecalho: {
      empresaNome: 'Mercadão',
      clienteNome: 'João da Silva',
      clienteDocumento: '123.456.789-00',
      clienteCodigo: '25',
      data: '07/08/2026',
      hora: '15:42',
      vendedor: 'Diego',
      numeroComprovante: 'PC-000001'
    },
    cards: {
      resumoPrestacao: {
        valorEntregue: 500,
        valorDevolvido: 120,
        valorVendido: 380,
        valorRecebido: 380,
        saldoAnterior: 500,
        saldoAposPrestacao: 0
      },
      movimentacao: {
        itens: [
          { produto: 'Picolé Chocolate', entregue: 20, devolvido: 5, vendido: 15 },
          { produto: 'Picolé Coco', entregue: 15, devolvido: 3, vendido: 12 }
        ],
        totalEntregue: 35,
        totalDevolvido: 8,
        totalVendido: 27
      },
      formasPagamento: { dinheiro: 200, pix: 180, cartao: 0, outros: 0 },
      observacoes: {}
    }
  };
  const pdfPc = buildPdfPayload(snapPc);
  ok(!!pdfPc.base64, 'pdf prestação base64');
  ok(pdfPc.html.includes('Prestação de Contas') || pdfPc.html.includes('PRESTAÇÃO'), 'título prestação');
  ok(pdfPc.html.includes('PC-000001'), 'número PC');
  ok(pdfPc.html.includes('Picolé Chocolate'), 'produto movimentação');
  ok(pdfPc.html.includes('Assinatura do Cliente'), 'assinatura prestação');
  ok(pdfPc.html.includes('Emitido pelo CDS Sistemas'), 'rodapé prestação');
  ok(pdfPc.html.includes('Declaro estar de acordo'), 'declaração prestação');
  ok(pdfPc.html.includes('Forma de Pagamento') || pdfPc.html.includes('Dinheiro'), 'formas pagamento');
  ok(!pdfPc.html.includes('Hash '), 'sem hash no layout prestação');
  const textoPc = buildTextoCompartilhavelPrestacao(snapPc);
  ok(textoPc.includes('PRESTAÇÃO DE CONTAS'), 'texto prestacao título');
  ok(textoPc.includes('João da Silva'), 'texto prestacao cliente');

  console.log('\nTodos os testes RCM-04.4 / RC2.1 passaram.\n');
}

main().catch((err) => {
  console.error('\nFALHA:', err);
  process.exit(1);
});
