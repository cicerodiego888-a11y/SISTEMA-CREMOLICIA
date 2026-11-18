/**
 * Resolvedor fiscal de entrada — finalidade USO_E_CONSUMO.
 *
 * Função pura: não grava, não emite documento fiscal e nunca altera os dados
 * originais do XML. Cada decisão devolve a regra e a origem aplicadas, para auditoria.
 *
 * Fonte dos códigos: Tabela de CFOP (Convênio S/Nº de 15/12/1970, Ajuste SINIEF 07/01 e
 * atualizações do CONFAZ). Referências desta versão:
 *   1.556 — Compra de material para uso ou consumo (operação interna)
 *   2.556 — Compra de material para uso ou consumo (operação interestadual)
 * O código só é proposto quando a operação real (UF emitente × UF destinatária × CFOP do XML)
 * confirma a natureza interna ou interestadual e não há tributação especial.
 */

const FINALIDADE_USO_E_CONSUMO = 'USO_E_CONSUMO';
const VERSAO_REGRAS = 'RESOLVEDOR_FISCAL_ENTRADA_V1';

const STATUS = Object.freeze({
  NAO_APLICAVEL: 'NAO_APLICAVEL',
  APLICAVEL: 'APLICAVEL',
  REQUER_VALIDACAO: 'REQUER_VALIDACAO',
  BLOQUEADO: 'BLOQUEADO'
});

const CRT_VALIDOS = ['1', '2', '3', '4'];
const NATUREZAS_INCOMPATIVEIS = {
  PRODUZIDO: 'produto produzido',
  COMERCIAL: 'mercadoria para revenda'
};
const CFOP_SAIDA_ST = ['5401', '5402', '5403', '5405', '6401', '6402', '6403', '6404'];
const CST_ST = ['10', '30', '60', '70'];
const CSOSN_ST = ['201', '202', '203', '500'];
const MIN_JUSTIFICATIVA = 10;

const somenteDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => String(v ?? '').trim();
const ufNormalizada = (v) => texto(v).toUpperCase();

function itemEhUsoEConsumo(item) {
  return texto(item?.finalidade_item).toUpperCase() === FINALIDADE_USO_E_CONSUMO;
}

function classificarEscopo(ufEmitente, ufDestinatario) {
  if (!ufEmitente || !ufDestinatario) return null;
  if (ufEmitente === 'EX' || ufDestinatario === 'EX') return 'EXTERIOR';
  return ufEmitente === ufDestinatario ? 'INTERNA' : 'INTERESTADUAL';
}

function resultadoBase(item) {
  return {
    finalidade: itemEhUsoEConsumo(item) ? FINALIDADE_USO_E_CONSUMO : null,
    status: STATUS.NAO_APLICAVEL,
    cfop_entrada: null,
    regra: null,
    origem_regra: null,
    escopo: null,
    mensagens: [],
    alertas: [],
    dados_xml_originais: {
      cfop: texto(item?.cfop_xml),
      cst_csosn: texto(item?.cst_csosn_xml),
      orig: texto(item?.orig_xml)
    }
  };
}

function bloquear(res, mensagem) {
  res.status = STATUS.BLOQUEADO;
  res.mensagens.push(mensagem);
  return res;
}

function aplicarCorrecaoOperador(res, item, usuarioId) {
  const manual = somenteDigitos(item?.cfop_entrada_manual);
  const justificativa = texto(item?.justificativa_fiscal);
  if (!manual) return res;

  if (!/^[123]\d{3}$/.test(manual)) {
    res.mensagens.push('CFOP de entrada informado pelo operador é inválido (use 4 dígitos iniciados em 1, 2 ou 3).');
    return res;
  }
  const esperado = { INTERNA: '1', INTERESTADUAL: '2', EXTERIOR: '3' }[res.escopo];
  if (esperado && manual[0] !== esperado) {
    res.mensagens.push(`CFOP de entrada ${manual} não corresponde à operação ${res.escopo.toLowerCase()} (deve iniciar em ${esperado}).`);
    return res;
  }
  if (justificativa.length < MIN_JUSTIFICATIVA) {
    res.mensagens.push(`Informe a justificativa da correção fiscal (mínimo ${MIN_JUSTIFICATIVA} caracteres).`);
    return res;
  }

  res.status = STATUS.APLICAVEL;
  res.cfop_entrada = manual;
  res.regra = 'CORRECAO_OPERADOR';
  res.origem_regra = `OPERADOR${usuarioId ? `:${usuarioId}` : ''} — ${VERSAO_REGRAS}`;
  res.mensagens = [];
  res.alertas.push(`CFOP de entrada ${manual} definido manualmente pelo operador.`);
  return res;
}

/**
 * @param {Object} params
 * @param {Object} params.item       finalidade_item, cfop_xml, cst_csosn_xml, orig_xml, produto_natureza,
 *                                   cfop_entrada_manual, justificativa_fiscal
 * @param {Object} params.documento  emitente_uf, emitente_crt, destinatario_uf, destinatario_cnpj
 * @param {Object} params.empresa    cnpj, uf, crt (cadastro fiscal da empresa)
 * @param {number|string} [params.usuarioId]
 */
function resolverFiscalEntrada({ item = {}, documento = {}, empresa = {}, usuarioId = null } = {}) {
  const res = resultadoBase(item);
  if (!itemEhUsoEConsumo(item)) return res;

  const natureza = texto(item.produto_natureza).toUpperCase();
  if (NATUREZAS_INCOMPATIVEIS[natureza]) {
    return bloquear(res, `O produto vinculado é ${NATUREZAS_INCOMPATIVEIS[natureza]}: não pode ser classificado como uso e consumo. Corrija o vínculo ou a classificação do item.`);
  }

  const cnpjEmpresa = somenteDigitos(empresa.cnpj);
  const crtEmpresa = texto(empresa.crt);
  const faltantes = [];
  if (cnpjEmpresa.length !== 14) faltantes.push('CNPJ da empresa');
  if (!CRT_VALIDOS.includes(crtEmpresa)) faltantes.push('regime tributário (CRT) da empresa');
  if (!ufNormalizada(empresa.uf)) faltantes.push('UF da empresa');
  if (faltantes.length) {
    return bloquear(res, `Cadastro fiscal da empresa incompleto: informe ${faltantes.join(', ')} em Configurações antes de concluir a entrada de uso e consumo.`);
  }

  const cnpjDestinatario = somenteDigitos(documento.destinatario_cnpj);
  if (cnpjDestinatario && cnpjDestinatario !== cnpjEmpresa) {
    return bloquear(res, 'O destinatário da NF-e não é o CNPJ desta empresa; a entrada não pode ser tratada como uso e consumo aqui.');
  }

  const ufEmitente = ufNormalizada(documento.emitente_uf);
  const ufDestinatario = ufNormalizada(documento.destinatario_uf);
  res.escopo = classificarEscopo(ufEmitente, ufDestinatario);

  const cfopXml = somenteDigitos(item.cfop_xml);
  const cstXml = texto(item.cst_csosn_xml);
  const crtEmitente = texto(documento.emitente_crt);

  if (!res.escopo) {
    res.status = STATUS.REQUER_VALIDACAO;
    res.mensagens.push('UF do emitente ou do destinatário ausente no XML processado: a natureza da operação (interna/interestadual) não pode ser determinada. Reprocesse o documento ou informe o CFOP de entrada com justificativa.');
  } else if (res.escopo === 'EXTERIOR') {
    res.status = STATUS.REQUER_VALIDACAO;
    res.mensagens.push('Operação com o exterior: o CFOP de entrada exige validação do operador.');
  }

  if (!cfopXml) {
    res.status = STATUS.REQUER_VALIDACAO;
    res.mensagens.push('CFOP do XML ausente: não é possível validar a operação.');
  } else if (res.escopo && res.escopo !== 'EXTERIOR') {
    const esperado = res.escopo === 'INTERNA' ? '5' : '6';
    if (!['5', '6'].includes(cfopXml[0]) || cfopXml[0] !== esperado) {
      res.status = STATUS.REQUER_VALIDACAO;
      res.mensagens.push(`CFOP do XML (${cfopXml}) diverge da operação ${res.escopo.toLowerCase()} (UF ${ufEmitente} → ${ufDestinatario}).`);
    }
  }

  const csosnSt = CSOSN_ST.includes(cstXml);
  const cstSt = cstXml.length === 2 && CST_ST.includes(cstXml);
  if (CFOP_SAIDA_ST.includes(cfopXml) || csosnSt || cstSt) {
    res.status = STATUS.REQUER_VALIDACAO;
    res.mensagens.push('Operação com ICMS-ST: o tratamento de entrada para uso e consumo exige validação e definição manual do CFOP.');
  }

  if (crtEmitente) {
    const emitenteSimples = ['1', '2', '4'].includes(crtEmitente);
    if (emitenteSimples && cstXml.length === 2) {
      res.status = STATUS.REQUER_VALIDACAO;
      res.mensagens.push(`Divergência no XML: emitente no Simples Nacional (CRT ${crtEmitente}) informou CST ${cstXml}.`);
    }
    if (crtEmitente === '3' && cstXml.length === 3) {
      res.status = STATUS.REQUER_VALIDACAO;
      res.mensagens.push(`Divergência no XML: emitente no regime normal (CRT 3) informou CSOSN ${cstXml}.`);
    }
  }

  if (res.status === STATUS.REQUER_VALIDACAO) {
    return aplicarCorrecaoOperador(res, item, usuarioId);
  }

  res.status = STATUS.APLICAVEL;
  if (res.escopo === 'INTERNA') {
    res.cfop_entrada = '1556';
    res.regra = 'USO_CONSUMO_INTERNA';
  } else {
    res.cfop_entrada = '2556';
    res.regra = 'USO_CONSUMO_INTERESTADUAL';
    res.alertas.push('Operação interestadual: verifique a apuração do DIFAL; este fluxo não calcula nem recolhe tributos.');
  }
  res.origem_regra = `${VERSAO_REGRAS} — Tabela CFOP vigente (${res.cfop_entrada}); UF ${ufEmitente}→${ufDestinatario}; CFOP XML ${cfopXml}; CRT empresa ${crtEmpresa}`;
  res.alertas.push('Dados fiscais originais do XML (CFOP, CST/CSOSN, origem) preservados; o CST/CSOSN do fornecedor não é copiado para a entrada.');
  return res;
}

/** Lê o cadastro fiscal da empresa (tabela de configurações do CDS). */
function carregarEmpresaFiscal(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT chave, valor FROM configuracoes WHERE chave IN ('cnpj', 'fiscal_uf_sigla', 'uf', 'fiscal_regime_tributario')`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        const mapa = Object.fromEntries((rows || []).map((r) => [r.chave, r.valor]));
        resolve({
          cnpj: mapa.cnpj || '',
          uf: mapa.fiscal_uf_sigla || mapa.uf || '',
          crt: mapa.fiscal_regime_tributario || ''
        });
      }
    );
  });
}

/** Resultado bloqueado quando não há origem fiscal confiável (ou o vínculo é inconsistente). */
function resolverBloqueioOrigem(item, mensagem) {
  return bloquear(resultadoBase(item), mensagem);
}

module.exports = {
  FINALIDADE_USO_E_CONSUMO,
  STATUS,
  itemEhUsoEConsumo,
  resolverFiscalEntrada,
  resolverBloqueioOrigem,
  carregarEmpresaFiscal
};
