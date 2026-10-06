/**
 * Validação REAL DistDFe — CDS-SORV-CE-01.6 / CE-01.6.2
 * Não faz parte da suíte automatizada (consome NSU real).
 * Executa exatamente UMA requisição DistDFe (maxIteracoes = 1), sujeita ao Gate
 * (cooldown 656 / ultNSU = maxNSU) e ao bloqueio de certificado incompatível.
 * Executar: node tests/central-entradas/ce01.6-live-distdfe.js
 */

const { getFiscalConfig } = require('../../backend/services/fiscal/configService');
const { inspecionarCertificadoPfx } = require('../../backend/services/fiscal/certificateService');
const { getDfeUrl, sincronizarDistribuicaoDFe } = require('../../backend/services/fiscal/distribuicaoDFe');
const { classificarErroSefaz } = require('../../backend/services/fiscal/sefazErroOperacional');
const CentralNsuRepository = require('../../backend/motores/central-entradas/repositories/CentralNsuRepository');
const { resolverDb, criarDbHelpers } = require('../../backend/motores/central-entradas/repositories/dbHelpers');
const sefazGate = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate');

async function contarDocumentos(sql) {
  const row = await sql.get('SELECT COUNT(*) AS total FROM central_entradas_documentos');
  return row?.total ?? 0;
}

(async () => {
  const sql = criarDbHelpers(resolverDb());
  await sql.whenReady();

  const cfg = await getFiscalConfig();
  const cnpj = String(cfg.cnpj || '').replace(/\D/g, '');
  const ambiente = Number(cfg.fiscal_ambiente || cfg.ambiente || 1);
  const uf = cfg.codigoUf || cfg.uf;

  console.log('[CE][LIVE] dbDir', resolverDb().dbDir);
  console.log('[CE][LIVE] cnpj', cnpj, 'uf', uf, 'ambiente', ambiente);
  console.log('[CE][LIVE] endpoint', getDfeUrl(ambiente));
  console.log('[CE][LIVE] certificadoPath', cfg.certificadoPath);

  try {
    const inspecao = inspecionarCertificadoPfx(cfg.certificadoPath, cfg.certificadoSenha);
    console.log('[CE][LIVE] certificado', {
      cnpj: inspecao.cnpj,
      compativel: inspecao.cnpj === cnpj,
      validadeAte: inspecao.notAfter ? inspecao.notAfter.toISOString() : null
    });
  } catch (error) {
    console.error('[CE][LIVE] certificado FALHA', error.codigo, error.message);
    process.exit(2);
  }

  const janela = await sefazGate.verificarJanelaSefaz(cnpj);
  console.log('[CE][LIVE] janela SEFAZ', janela);

  const nsuRepo = new CentralNsuRepository();
  const antes = await nsuRepo.obterOuCriar(cnpj, ambiente);
  const docsAntes = await contarDocumentos(sql);
  console.log('[CE][LIVE] antes', { ultNsu: antes.ultNsu, maxNsu: antes.maxNsu, documentos: docsAntes });

  const horario = new Date().toISOString();
  let resultado;
  try {
    resultado = await sincronizarDistribuicaoDFe({ maxIteracoes: 1, origem: 'manual' });
  } catch (error) {
    const classificado = classificarErroSefaz(error);
    resultado = {
      sucesso: false,
      cStat: error.cStat || null,
      xMotivo: error.xMotivo || null,
      erro: classificado,
      janelaSefaz: error.janelaSefaz || null
    };
  }

  const depois = await nsuRepo.obterOuCriar(cnpj, ambiente);
  const docsDepois = await contarDocumentos(sql);

  console.log('[CE][LIVE] horario', horario);
  console.log('[CE][LIVE] resultado', {
    sucesso: resultado.sucesso,
    cStat: resultado.cStat,
    xMotivo: resultado.xMotivo,
    ultNsuRetorno: resultado.ultNsu,
    maxNsuRetorno: resultado.maxNsu,
    notasNovas: resultado.notasNovas,
    notasDuplicadas: resultado.notasDuplicadas,
    xmlCompleto: resultado.xmlCompleto,
    xmlAguardando: resultado.xmlAguardando,
    iteracoes: resultado.iteracoes,
    proximaConsultaApos: resultado.proximaConsultaApos,
    erro: resultado.erro,
    janelaSefaz: resultado.janelaSefaz
  });
  console.log('[CE][LIVE] depois', {
    ultNsu: depois.ultNsu,
    maxNsu: depois.maxNsu,
    documentos: docsDepois,
    persistidosNestaConsulta: docsDepois - docsAntes
  });
  process.exit(0);
})().catch((error) => {
  console.error('[CE][LIVE] FALHA', error.codigo || error.code, error.message);
  process.exit(1);
});
