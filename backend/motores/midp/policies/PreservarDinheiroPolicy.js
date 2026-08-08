/**
 * PreservarDinheiroPolicy — Política oficial PRESERVAR_DINHEIRO (RC3 FINAL).
 *
 * Usa o Motor Fiscal (intervalo) + itens + pagamentos para decidir
 * quantidade/valor fiscal com prioridade aos meios eletrônicos.
 * Dinheiro só complementa a próxima unidade comercial inteira.
 *
 * O DistribuidorPagamento recebe apenas totais finais (sem margem/produtos/política).
 *
 * @module motores/midp/policies/PreservarDinheiroPolicy
 */

const IMidpPolicy = require('./IMidpPolicy');
const MidpEngine = require('../MidpEngine');
const MidpResult = require('../MidpResult');
const {
  calcular,
  FORMAS_ELETRONICAS
} = require('./PreservarDinheiroCalculator');

const EPS = 0.009;

function arredondar2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

/**
 * Extrai intervalo fiscal do FiscalOperacionalResult (ou shape compatível).
 * Não recalcula — apenas lê o que o Motor Fiscal já forneceu.
 */
function lerIntervaloFiscal(entrada = {}) {
  const fo = entrada.fiscalOperacional || entrada.fiscal || null;

  if (fo && typeof fo === 'object') {
    const maximo = arredondar2(
      fo.valorFiscalMaximo ?? fo.valorFiscalEfetivo ?? fo.valorFiscal ?? fo.totalFiscal ?? entrada.valorFiscal
    );
    const minimo = arredondar2(
      fo.valorFiscalMinimo != null ? fo.valorFiscalMinimo : maximo
    );
    const naoFiscal = arredondar2(
      fo.valorNaoFiscal ?? fo.totalNaoFiscal ?? entrada.valorNaoFiscal
    );
    const margem = arredondar2(
      fo.margemFiscalDisponivel != null
        ? fo.margemFiscalDisponivel
        : Math.max(0, maximo - minimo)
    );
    const possui = fo.possuiMargemFiscal === true || margem > EPS;

    return {
      valorFiscalMaximo: maximo,
      valorFiscalMinimo: Math.min(maximo, Math.max(0, minimo)),
      margemFiscalDisponivel: margem,
      possuiMargemFiscal: possui,
      valorNaoFiscal: naoFiscal
    };
  }

  const maximo = arredondar2(entrada.valorFiscal);
  const naoFiscal = arredondar2(entrada.valorNaoFiscal);
  return {
    valorFiscalMaximo: maximo,
    valorFiscalMinimo: maximo,
    margemFiscalDisponivel: 0,
    possuiMargemFiscal: false,
    valorNaoFiscal: naoFiscal
  };
}

/** @deprecated use calcular() — mantido para testes RC3 iniciais */
function decidirEfetivoProposto(intervalo, pagamentos, itens) {
  return calcular(intervalo, pagamentos, itens);
}

function registrarDecisao(decisao) {
  const payload = {
    motor: 'MIDP',
    evento: 'DECISAO_PRESERVAR_DINHEIRO',
    politica: decisao.politica,
    algoritmo: decisao.algoritmo,
    versao: decisao.versao,
    valorFiscalMaximo: decisao.valorFiscalMaximo,
    valorFiscalMinimo: decisao.valorFiscalMinimo,
    margemFiscalDisponivel: decisao.margemFiscalDisponivel,
    valorFiscalEfetivo: decisao.valorFiscalEfetivo,
    quantidadeFiscal: decisao.quantidadeFiscal,
    quantidadeNaoFiscal: decisao.quantidadeNaoFiscal,
    valorFiscalPIX: decisao.valorFiscalPIX,
    valorFiscalDinheiro: decisao.valorFiscalDinheiro,
    valorEletronico: decisao.valorEletronico,
    valorDinheiro: decisao.valorDinheiro,
    economiaDinheiro: decisao.economiaDinheiro,
    valorNaoFiscal: decisao.valorNaoFiscal,
    tempoMs: decisao.tempoMs
  };
  console.log('[MIDP-DECISAO]', JSON.stringify(payload));
  return payload;
}

class PreservarDinheiroPolicy extends IMidpPolicy {
  getNome() {
    return 'PRESERVAR_DINHEIRO';
  }

  getAlgoritmo() {
    return 'PreservarDinheiroPolicy.RC3.FINAL';
  }

  /**
   * @param {import('./IMidpPolicy').MidpPolicyEntrada} entrada
   * @param {import('./IMidpPolicy').MidpPolicyContexto} [contexto]
   * @returns {MidpResult}
   */
  executar(entrada = {}, contexto = {}) {
    const inicio = Date.now();
    const intervalo = lerIntervaloFiscal(entrada);
    const pagamentos = Array.isArray(entrada.pagamentos) ? entrada.pagamentos : [];
    const itens = Array.isArray(entrada.itens) ? entrada.itens : [];

    const decisao = calcular(intervalo, pagamentos, itens);
    registrarDecisao(decisao);

    // DistribuidorPagamento recebe apenas valores finais (sem margem/produtos/política)
    const distribuicao = MidpEngine.executar(
      {
        valorFiscal: decisao.valorFiscalEfetivo,
        valorNaoFiscal: decisao.valorNaoFiscal,
        pagamentos
      },
      { midpAtivado: contexto.midpAtivado === true }
    );

    const resultado = new MidpResult({
      pagamentosFiscal: distribuicao.pagamentosFiscal,
      pagamentosNaoFiscal: distribuicao.pagamentosNaoFiscal,
      tempoMs: Date.now() - inicio,
      saldoFiscal: distribuicao.saldoFiscal,
      saldoNaoFiscal: distribuicao.saldoNaoFiscal,
      midpAtivado: contexto.midpAtivado === true,
      politica: this.getNome(),
      algoritmo: this.getAlgoritmo(),
      origem: contexto.origem || null,
      versao: MidpResult.VERSAO
    });

    resultado.decisao = decisao;
    return resultado;
  }
}

module.exports = PreservarDinheiroPolicy;
module.exports.decidirEfetivoProposto = decidirEfetivoProposto;
module.exports.lerIntervaloFiscal = lerIntervaloFiscal;
module.exports.FORMAS_ELETRONICAS = FORMAS_ELETRONICAS;
module.exports.calcular = calcular;
