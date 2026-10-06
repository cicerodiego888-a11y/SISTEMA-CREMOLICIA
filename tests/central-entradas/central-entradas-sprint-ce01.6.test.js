/**
 * Testes — Central de Entradas Sprint CDS-SORV-CE-01.6
 * Executar: npm run test:central-entradas-ce01.6
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const forge = require('node-forge');

const { getDfeUrl, sincronizarDistribuicaoDFe } = require('../../backend/services/fiscal/distribuicaoDFe');
const {
  classificarErroSefaz,
  CODIGOS
} = require('../../backend/services/fiscal/sefazErroOperacional');
const { inspecionarCertificadoPfx } = require('../../backend/services/fiscal/certificateService');
const { classificarXml, CLASSE_XML } = require('../../backend/motores/central-entradas/core/xmlDocumento');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const CentralDfePersistenciaService = require('../../backend/motores/central-entradas/services/CentralDfePersistenciaService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const CentralNsuRepository = require('../../backend/motores/central-entradas/repositories/CentralNsuRepository');
const { CentralSyncExecucaoService } = require('../../backend/motores/central-entradas/services/CentralSyncExecucaoService');
const sefazGate = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate');
const { CentralXmlWaitScheduler } = require('../../backend/motores/central-entradas/services/CentralXmlWaitScheduler');
const CentralProcessamentoService = require('../../backend/motores/central-entradas/services/CentralProcessamentoService');
const NFeParserService = require('../../backend/shared/nfe/NFeParserService');
const { enriquecerParseComMiip } = require('../../backend/shared/nfe/enriquecerParseComMiip');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');

let passou = 0;
let falhou = 0;

const CHAVE_CE016 = '23250736811652000153550010000001601000001601';
const CHAVE_CE016B = '23250736811652000153550010000001602000001602';

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function criarXmlCompleto(chave) {
  return `<?xml version="1.0"?><nfeProc><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}"><ide><nNF>1601</nNF><serie>1</serie><dhEmi>2026-10-04T10:00:00-03:00</dhEmi></ide><emit><CNPJ>36811652000153</CNPJ><xNome>Fornecedor CE016</xNome></emit><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

function criarXmlResumo(chave) {
  return `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>${chave}</chNFe><CNPJ>36811652000153</CNPJ><xNome>Resumo CE016</xNome></resNFe>`;
}

function montarRetornoSoap({ cStat = '138', xMotivo = 'Documento localizado', ultNSU = '5', maxNSU = '5', documentos = [] }) {
  const docZips = documentos.map((doc) => {
    const compactado = zlib.gzipSync(Buffer.from(doc.xml, 'utf8')).toString('base64');
    return `<docZip NSU="${doc.nsu}" schema="${doc.schema || 'procNFe_v4.00.xsd'}">${compactado}</docZip>`;
  }).join('');

  return `
<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe">
  <cStat>${cStat}</cStat>
  <xMotivo>${xMotivo}</xMotivo>
  <ultNSU>${ultNSU}</ultNSU>
  <maxNSU>${maxNSU}</maxNSU>
  <loteDistDFeInt>${docZips}</loteDistDFeInt>
</retDistDFeInt>`;
}

function criarPfxArquivo({ cnpj = '36811652000153', senha = 'teste', expirado = false, ouCnpj = null } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = expirado
    ? new Date(Date.now() - 3600000)
    : new Date(Date.now() + 86400000 * 30);
  const attrs = [
    { shortName: 'C', value: 'BR' },
    { shortName: 'O', value: 'ICP-Brasil' },
    { shortName: 'OU', value: 'Certificado Digital PJ A1' }
  ];
  if (ouCnpj) attrs.push({ shortName: 'OU', value: ouCnpj });
  attrs.push({ shortName: 'CN', value: `EMPRESA:${cnpj}` });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  const arquivo = path.join(os.tmpdir(), `ce016-${Date.now()}-${Math.random().toString(16).slice(2)}.pfx`);
  fs.writeFileSync(arquivo, Buffer.from(der, 'binary'));
  return arquivo;
}

function criarNsuMemoria(ultNsu = '000000000000000', maxNsu = '000000000000000') {
  const estado = {
    id: 1,
    cnpj: '36811652000153',
    ambiente: 1,
    ultNsu,
    maxNsu,
    dataSincronizacao: null
  };
  return {
    estado,
    async obterOuCriar() {
      return { ...estado };
    },
    async atualizarSincronizacao(_id, dados) {
      const { nsuMenorQue, normalizarNsu } = require('../../backend/services/fiscal/dfeRetornoParser');
      if (dados.ultNsu != null && nsuMenorQue(normalizarNsu(dados.ultNsu), normalizarNsu(estado.ultNsu))) {
        /* não retrocede */
      } else if (dados.ultNsu != null) {
        estado.ultNsu = dados.ultNsu;
      }
      if (dados.maxNsu != null && !nsuMenorQue(normalizarNsu(dados.maxNsu), normalizarNsu(estado.maxNsu))) {
        estado.maxNsu = dados.maxNsu;
      }
      estado.dataSincronizacao = new Date().toISOString();
      return { ...estado };
    }
  };
}

const nsuControleStub = {
  registrarConsultaEDetectarLacunas: async () => ({ lacunas: [] })
};

function configFiscalFake() {
  return {
    certificadoPath: 'C:\\fake\\cert.pfx',
    certificadoSenha: 'x',
    cnpj: '36811652000153',
    fiscal_ambiente: 1,
    fiscal_codigo_uf: '23'
  };
}

function criarGateMemoria() {
  const mapa = new Map();
  return new sefazGate.CentralSefazOperationalGate({
    minIntervaloMs: 1,
    janelaStore: {
      async obter(cnpj) {
        return { ultimo656Em: null, nsuAlcancadoEm: null, ...(mapa.get(cnpj) || {}) };
      },
      async salvar(cnpj, estado) {
        mapa.set(cnpj, { ...estado });
      }
    }
  });
}

async function sincronizarFake(opcoes) {
  return sincronizarDistribuicaoDFe({
    config: configFiscalFake(),
    sefazGate: criarGateMemoria(),
    pularInspecaoCertificado: true,
    nsuControleService: nsuControleStub,
    maxIteracoes: 1,
    ...opcoes
  });
}

async function limparDocumento(chave) {
  const documentosRepository = new CentralDocumentosRepository();
  const historicoRepository = new CentralHistoricoRepository();
  const existente = await documentosRepository.buscarPorChave(chave);
  if (!existente) return;
  await historicoRepository._obterSql().run(
    'DELETE FROM central_entradas_historico WHERE documento_id = ?',
    [existente.id]
  );
  await documentosRepository.remover(existente.id);
}

async function main() {
  console.log('\n=== Testes Central de Entradas — CDS-SORV-CE-01.6 ===\n');

  await test('URL DistDFe de produção permanece www1', async () => {
    const url = getDfeUrl(1);
    assert.ok(url.includes('www1.nfe.fazenda.gov.br'));
    assert.ok(!url.includes('://www.nfe.fazenda.gov.br/'));
  });

  await test('certificado e-PJ usa CNPJ do CN, não o OU técnico', async () => {
    const arquivo = criarPfxArquivo({
      cnpj: '36811652000153',
      ouCnpj: '45616309000149'
    });
    try {
      const inspecao = inspecionarCertificadoPfx(arquivo, 'teste');
      assert.strictEqual(inspecao.cnpj, '36811652000153');
      assert.notStrictEqual(inspecao.cnpj, '45616309000149');
    } finally {
      fs.unlinkSync(arquivo);
    }
  });

  await test('certificado válido é inspecionado', async () => {
    const arquivo = criarPfxArquivo({ cnpj: '36811652000153' });
    try {
      const inspecao = inspecionarCertificadoPfx(arquivo, 'teste');
      assert.strictEqual(inspecao.encontrado, true);
      assert.strictEqual(inspecao.expirado, false);
      assert.strictEqual(inspecao.cnpj, '36811652000153');
    } finally {
      fs.unlinkSync(arquivo);
    }
  });

  await test('certificado ausente gera CERTIFICATE_NOT_FOUND', async () => {
    assert.throws(
      () => inspecionarCertificadoPfx('C:\\nao-existe\\cert.pfx', 'x'),
      (error) => error.codigo === 'CERTIFICATE_NOT_FOUND'
    );
    assert.strictEqual(
      classificarErroSefaz({ message: 'Certificado não encontrado em: C:\\x.pfx' }).codigo,
      CODIGOS.CERTIFICATE_NOT_FOUND
    );
  });

  await test('certificado expirado gera CERTIFICATE_EXPIRED', async () => {
    const arquivo = criarPfxArquivo({ expirado: true });
    try {
      assert.throws(
        () => inspecionarCertificadoPfx(arquivo, 'teste'),
        (error) => error.codigo === 'CERTIFICATE_EXPIRED'
      );
    } finally {
      fs.unlinkSync(arquivo);
    }
  });

  await test('erro TLS não é mascarado como SEFAZ indisponível', async () => {
    const classificado = classificarErroSefaz({
      message: 'unable to get local issuer certificate',
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    });
    assert.strictEqual(classificado.codigo, CODIGOS.TLS_ERROR);
    assert.notStrictEqual(classificado.codigo, CODIGOS.SEFAZ_INDISPONIVEL);
  });

  await test('SEFAZ indisponível permanece HTTP 5xx operacional', async () => {
    const classificado = classificarErroSefaz({
      message: 'Request failed with status code 503',
      response: { status: 503 }
    });
    assert.strictEqual(classificado.codigo, CODIGOS.SEFAZ_INDISPONIVEL);
    assert.strictEqual(classificado.operacional, true);
  });

  await test('timeout DistDFe é TIMEOUT operacional', async () => {
    const classificado = classificarErroSefaz({
      message: 'timeout of 90000ms exceeded',
      code: 'ECONNABORTED'
    });
    assert.strictEqual(classificado.codigo, CODIGOS.TIMEOUT);
  });

  await test('resposta SEFAZ com documentos persiste e avança NSU', async () => {
    await limparDocumento(CHAVE_CE016);
    const nsu = criarNsuMemoria();
    const persistencia = new CentralDfePersistenciaService();
    const xml = montarRetornoSoap({
      cStat: '138',
      ultNSU: '10',
      maxNSU: '10',
      documentos: [{ nsu: '10', xml: criarXmlCompleto(CHAVE_CE016) }]
    });

    const resultado = await sincronizarFake({
      nsuRepository: nsu,
      persistenciaService: persistencia,
      enviarConsultaDfe: async () => xml
    });

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.cStat, '138');
    assert.strictEqual(resultado.notasNovas, 1);
    assert.strictEqual(resultado.xmlCompleto, 1);
    assert.strictEqual(resultado.ultNsu, '000000000000010');
    const doc = await new CentralDocumentosRepository().buscarPorChave(CHAVE_CE016);
    assert.ok(doc);
    assert.strictEqual(doc.status, DocumentoFiscalStatus.SINCRONIZADA);
    await limparDocumento(CHAVE_CE016);
  });

  await test('resposta SEFAZ sem documentos (cStat 137) não inventa nota', async () => {
    const nsu = criarNsuMemoria('000000000000020', '000000000000020');
    const resultado = await sincronizarFake({
      nsuRepository: nsu,
      persistenciaService: {
        persistirDocumentoDfe: async () => {
          throw new Error('não deveria persistir');
        }
      },
      enviarConsultaDfe: async () => montarRetornoSoap({
        cStat: '137',
        xMotivo: 'Nenhum documento localizado',
        ultNSU: '20',
        maxNSU: '20'
      })
    });
    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.notasNovas, 0);
    assert.strictEqual(resultado.cStat, '137');
  });

  await test('NSU inicial parte de 000000000000000', async () => {
    const nsu = criarNsuMemoria();
    let enviado = null;
    await sincronizarFake({
      nsuRepository: nsu,
      persistenciaService: { persistirDocumentoDfe: async () => ({ novo: false, duplicado: false, ignorado: true }) },
      enviarConsultaDfe: async (xmlConsulta) => {
        enviado = xmlConsulta.match(/<ultNSU>(\d+)<\/ultNSU>/)[1];
        return montarRetornoSoap({ cStat: '137', ultNSU: '0', maxNSU: '0' });
      }
    });
    assert.strictEqual(enviado, '000000000000000');
  });

  await test('NSU subsequente parte do valor persistido', async () => {
    const nsu = criarNsuMemoria('000000000000148', '000000000000148');
    let enviado = null;
    await sincronizarFake({
      nsuRepository: nsu,
      persistenciaService: { persistirDocumentoDfe: async () => ({ novo: false, duplicado: false, ignorado: true }) },
      enviarConsultaDfe: async (xmlConsulta) => {
        enviado = xmlConsulta.match(/<ultNSU>(\d+)<\/ultNSU>/)[1];
        return montarRetornoSoap({ cStat: '137', ultNSU: '148', maxNSU: '148' });
      }
    });
    assert.strictEqual(enviado, '000000000000148');
  });

  await test('NSU não pode retroceder', async () => {
    const nsu = criarNsuMemoria('000000000000200', '000000000000200');
    const resultado = await sincronizarFake({
      nsuRepository: nsu,
      persistenciaService: { persistirDocumentoDfe: async () => ({ novo: false, duplicado: false, ignorado: true }) },
      enviarConsultaDfe: async () => montarRetornoSoap({
        cStat: '137',
        ultNSU: '50',
        maxNSU: '50'
      })
    });
    assert.strictEqual(resultado.ultNsu, '000000000000200');
    assert.strictEqual(nsu.estado.ultNsu, '000000000000200');
  });

  await test('documento duplicado é idempotente', async () => {
    await limparDocumento(CHAVE_CE016B);
    const persistencia = new CentralDfePersistenciaService();
    const xml = criarXmlCompleto(CHAVE_CE016B);
    const primeiro = await persistencia.persistirDocumentoDfe({ xml, nsu: '1', origem: 'dfe' });
    const segundo = await persistencia.persistirDocumentoDfe({ xml, nsu: '1', origem: 'dfe' });
    assert.strictEqual(primeiro.novo, true);
    assert.strictEqual(segundo.duplicado, true);
    await limparDocumento(CHAVE_CE016B);
  });

  await test('XML completo não fica em AGUARDANDO_XML', async () => {
    assert.strictEqual(classificarXml(criarXmlCompleto(CHAVE_CE016)), CLASSE_XML.COMPLETO);
  });

  await test('XML incompleto/resumo fica AGUARDANDO_XML', async () => {
    await limparDocumento(CHAVE_CE016);
    const persistencia = new CentralDfePersistenciaService();
    const resultado = await persistencia.persistirDocumentoDfe({
      xml: criarXmlResumo(CHAVE_CE016),
      nsu: '11',
      origem: 'dfe'
    });
    assert.strictEqual(resultado.aguardandoXml, true);
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML);
    await limparDocumento(CHAVE_CE016);
  });

  await test('recuperação de XML completo no mesmo documento não duplica', async () => {
    await limparDocumento(CHAVE_CE016);
    const persistencia = new CentralDfePersistenciaService();
    await persistencia.persistirDocumentoDfe({
      xml: criarXmlResumo(CHAVE_CE016),
      nsu: '12',
      origem: 'dfe'
    });
    const recuperado = await persistencia.persistirDocumentoDfe({
      xml: criarXmlCompleto(CHAVE_CE016),
      nsu: '12',
      origem: 'dfe'
    });
    assert.strictEqual(recuperado.recuperado, true);
    assert.strictEqual(recuperado.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    const docs = await new CentralDocumentosRepository().buscarPorChave(CHAVE_CE016);
    assert.ok(docs);
    await limparDocumento(CHAVE_CE016);
  });

  await test('scheduler de recuperação existe e respeita o Gate', async () => {
    const scheduler = new CentralXmlWaitScheduler({
      flags: { estaHabilitado: () => true },
      configService: { obterResumo: async () => ({ xmlWaitMaxPorCiclo: 1 }) },
      documentosRepository: { listar: async () => [] },
      sefazGate: { podeConsultar: () => false }
    });
    const ciclo = await scheduler.executarCiclo();
    assert.strictEqual(ciclo.ignorado, true);
  });

  await test('cooldown do Gate não é erro interno e não impede abrir a Central', async () => {
    sefazGate.resetar();
    const gate = new sefazGate.CentralSefazOperationalGate({
      minIntervaloMs: 0,
      limiteFalhas: 1,
      cooldownErroMs: 60 * 1000
    });
    try {
      await gate.executar(async () => {
        throw new Error('SEFAZ timeout');
      });
    } catch { /* esperado */ }
    assert.strictEqual(gate.podeConsultar(), false);
    const classificado = classificarErroSefaz({
      message: 'Cooldown SEFAZ ativo',
      code: 'SEFAZ_GATE_BLOQUEADO',
      statusCode: 429
    });
    assert.strictEqual(classificado.codigo, CODIGOS.GATE);
    const abertura = await new CentralEntradasService().abrirCentral();
    assert.strictEqual(abertura.centralAberta, true);
    sefazGate.resetar();
  });

  await test('chamadas concorrentes: segunda sync é controlada', async () => {
    let emCurso = 0;
    const exec = new CentralSyncExecucaoService({
      sincronizacaoService: {
        sincronizar: async () => {
          emCurso += 1;
          await new Promise((resolve) => setTimeout(resolve, 80));
          emCurso -= 1;
          return { sucesso: true, notasNovas: 0, mensagem: 'ok' };
        }
      },
      configService: {
        obterResumo: async () => ({ syncMaxDocumentos: 50, notificarNovasNotas: false })
      },
      eventosService: { registrar: async () => {} },
      notificacoesService: { notificarSyncConcluida: async () => {} }
    });

    const primeira = exec.executar({ origem: 'manual', ignorarHorario: true });
    const segunda = await exec.executar({ origem: 'manual', ignorarHorario: true });
    assert.strictEqual(segunda.ignorado, true);
    await primeira;
    assert.strictEqual(emCurso, 0);
  });

  await test('erro SOAP não avança NSU', async () => {
    const nsu = criarNsuMemoria('000000000000077', '000000000000077');
    await assert.rejects(
      () => sincronizarFake({
        nsuRepository: nsu,
        persistenciaService: { persistirDocumentoDfe: async () => ({ novo: false }) },
        enviarConsultaDfe: async () => {
          const erro = new Error('timeout of 90000ms exceeded');
          erro.code = 'ECONNABORTED';
          throw erro;
        }
      }),
      (error) => error.codigo === CODIGOS.TIMEOUT || /tempo limite/i.test(error.message)
    );
    assert.strictEqual(nsu.estado.ultNsu, '000000000000077');
  });

  await test('rejeição SEFAZ não avança NSU', async () => {
    const nsu = criarNsuMemoria('000000000000090', '000000000000090');
    await assert.rejects(
      () => sincronizarFake({
        nsuRepository: nsu,
        persistenciaService: { persistirDocumentoDfe: async () => ({ novo: false }) },
        enviarConsultaDfe: async () => montarRetornoSoap({
          cStat: '215',
          xMotivo: 'Rejeicao: Falha no schema XML',
          ultNSU: '999',
          maxNSU: '999'
        })
      }),
      (error) => error.codigo === CODIGOS.SEFAZ_REJEICAO || /rejeic/i.test(error.message)
    );
    assert.strictEqual(nsu.estado.ultNsu, '000000000000090');
  });

  await test('Parser e MIIP continuam exportáveis (não quebrados neste sprint)', async () => {
    assert.ok(NFeParserService);
    assert.strictEqual(typeof enriquecerParseComMiip, 'function');
    const proc = new CentralProcessamentoService();
    assert.strictEqual(typeof proc.processar, 'function');
  });

  await test('processamento recusa XML insuficiente', async () => {
    const proc = new CentralProcessamentoService({
      documentosRepository: {
        buscarPorId: async () => ({
          id: 1,
          status: DocumentoFiscalStatus.AGUARDANDO_XML,
          xml: criarXmlResumo(CHAVE_CE016)
        })
      },
      historicoService: { registrar: async () => {} }
    });
    const resultado = await proc.processar(1);
    assert.strictEqual(resultado.sucesso, false);
    assert.match(resultado.mensagem || '', /XML não disponível/i);
  });

  await test('repositório real bloqueia regressão de NSU', async () => {
    const repo = new CentralNsuRepository();
    const cnpj = '00000000000166';
    const existente = await repo.buscarPorCnpjAmbiente(cnpj, 2);
    if (existente) await repo.remover(existente.id);
    const criado = await repo.obterOuCriar(cnpj, 2);
    await repo.atualizarSincronizacao(criado.id, { ultNsu: '000000000000300', maxNsu: '000000000000300' });
    const bloqueado = await repo.atualizarSincronizacao(criado.id, { ultNsu: '000000000000010', maxNsu: '000000000000010' });
    assert.strictEqual(bloqueado.ultNsu, '000000000000300');
    await repo.remover(criado.id);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
