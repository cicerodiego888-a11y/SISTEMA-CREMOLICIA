const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { getFiscalConfigNfe, setConfiguracao } = require('./configService');
const { carregarCertificadoPfx, extrairNomeEmpresaDoCertificado } = require('./certificateService');
const { assinarNFe } = require('./signer');
const { montarLote, enviarLote } = require('./soapClient');
const {
  onlyDigits,
  padLeft,
  formatNumber,
  nowDhEmi,
  gerarCodigoNumerico,
  gerarChaveAcesso,
  xmlEscape,
  compactarXml
} = require('./utils');
const { getFiscalSubDir } = require('./paths');

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('debug/nfe-devolucao');
  fs.writeFileSync(path.join(pasta, nome), String(conteudo || ''), 'utf8');
}

function getUrlNFe55(config) {
  return Number(config.ambiente) === 1
    ? 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx'
    : 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
}

function getConfiguracao(chave, padrao = '') {
  return new Promise((resolve, reject) => {
    db.get('SELECT valor FROM configuracoes WHERE chave = ?', [chave], (err, row) => {
      if (err) return reject(err);
      resolve(row?.valor || padrao);
    });
  });
}

async function proximoNumeroNFeDevolucao() {
  const atual = Number(await getConfiguracao('fiscal_numero_atual_nfe_devolucao', '1')) || 1;
  await setConfiguracao('fiscal_numero_atual_nfe_devolucao', String(atual + 1), 'number', 'Próximo número NF-e devolução de compra');
  return atual;
}

function garantirTabelas() {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS nfe_devolucoes_compra (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compra_id INTEGER NOT NULL,
        numero INTEGER,
        serie INTEGER,
        chave_acesso TEXT,
        protocolo TEXT,
        ambiente INTEGER,
        status TEXT,
        xml_enviado TEXT,
        xml_retorno TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => err ? reject(err) : resolve());
  });
}

function carregarCompra(compraId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT c.*, f.rua, f.numero, f.bairro, f.cidade, f.uf, f.cep, f.inscricao_estadual
      FROM compras c
      LEFT JOIN fornecedores f
        ON REPLACE(REPLACE(REPLACE(REPLACE(f.cpf_cnpj,'.',''),'/',''),'-',''),' ','') =
           REPLACE(REPLACE(REPLACE(REPLACE(c.fornecedor_cnpj,'.',''),'/',''),'-',''),' ','')
      WHERE c.id = ?
    `, [compraId], (err, compra) => {
      if (err) return reject(err);
      if (!compra) return reject(new Error('Compra não encontrada.'));

      db.all(`
        SELECT
          cd.*,
          ci.descricao_produto,
          ci.codigo_barras,
          ci.ncm,
          ci.unidade,
          p.nome AS produto_nome,
          p.codigo AS produto_codigo,
          p.codigo_barras AS produto_codigo_barras,
          p.ncm AS produto_ncm,
          p.unidade AS produto_unidade
        FROM compras_devolucoes cd
        INNER JOIN compras_itens ci ON ci.id = cd.compra_item_id
        LEFT JOIN produtos p ON p.id = cd.produto_id
        WHERE cd.compra_id = ?
        ORDER BY cd.id
      `, [compraId], (itErr, itens) => {
        if (itErr) return reject(itErr);
        if (!itens.length) return reject(new Error('Esta compra ainda não possui devolução interna registrada.'));
        resolve({ compra, itens });
      });
    });
  });
}

function buildXmlNFeDevolucao({ config, compra, itens, numero }) {
  console.log("FORNECEDOR COMPLETO:", compra);

  if (!onlyDigits(compra.chave_acesso) || onlyDigits(compra.chave_acesso).length !== 44) {
    throw new Error('A compra precisa ter a chave de acesso da NF-e original com 44 dígitos.');
  }

  function limparCNPJ(cnpj) {
    return String(cnpj || "").replace(/\D/g, "");
  }

  function extrairCnpjDaChave(chave) {
    const limpa = String(chave || "").replace(/\D/g, "");
    return limpa.length === 44 ? limpa.substring(6, 20) : null;
  }

  let cnpjFornecedor =
    limparCNPJ(compra.cnpj) ||
    limparCNPJ(compra.cpf_cnpj) ||
    limparCNPJ(compra.documento) ||
    limparCNPJ(compra.fornecedor_cnpj);

  if (!cnpjFornecedor) {
    cnpjFornecedor = extrairCnpjDaChave(compra.chave_acesso);
  }

  if (!cnpjFornecedor || cnpjFornecedor.length !== 14) {
    console.error("Fornecedor recebido:", compra);
    throw new Error("Fornecedor da compra sem CNPJ válido.");
  }

  const dhEmi = nowDhEmi();
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  const cNF = gerarCodigoNumerico();

  const chave = gerarChaveAcesso({
    uf: config.codigoUf,
    aamm,
    cnpj: config.cnpj,
    modelo: '55',
    serie: config.serie,
    numero,
    tpEmis: '1',
    cNF
  });

  const idDest = String((compra.uf || config.uf || '').toUpperCase()) === String(config.uf || '').toUpperCase() ? '1' : '2';
  const cfop = idDest === '1' ? '5202' : '6202';

  // Try to get company name from certificate
  let nomeEmpresaCertificado = null;
  if (config.certificadoPath && config.certificadoSenha) {
    try {
      nomeEmpresaCertificado = extrairNomeEmpresaDoCertificado(config.certificadoPath, config.certificadoSenha);
    } catch (error) {
      console.error('Erro ao extrair nome do certificado, usando nome da configuração:', error);
    }
  }

  const nomeEmpresa = nomeEmpresaCertificado || config.nomeEmpresa || 'EMPRESA NAO INFORMADA';
  
  // Generate xFant by removing corporate suffixes (LTDA, EIRELI, ME, etc.)
  const xFant = nomeEmpresa
    .replace(/\s+(LTDA|EIRELI|ME|EPP|SS|S\/A|S\.A\.|LIMITADA|LIMITADA|SOCIEDADE)\.?$/gi, '')
    .trim() || nomeEmpresa;

  let totalProdutos = 0;

  const detXml = itens.map((item, idx) => {
    const nome = item.produto_nome || item.descricao_produto || 'PRODUTO DEVOLVIDO';
    const codigo = item.produto_codigo || item.produto_id || item.id;
    const ncm = onlyDigits(item.produto_ncm || item.ncm || '00000000').padEnd(8, '0').slice(0, 8);
    const unidade = item.produto_unidade || item.unidade || 'UN';
    const qtd = Number(item.quantidade || 0);
    const valorUnit = Number(item.valor_unitario || 0);
    const valorTotal = Number((qtd * valorUnit).toFixed(2));

    totalProdutos += valorTotal;

    return `
      <det nItem="${idx + 1}">
        <prod>
          <cProd>${xmlEscape(codigo)}</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>${xmlEscape(nome)}</xProd>
          <NCM>${ncm}</NCM>
          <CFOP>${cfop}</CFOP>
          <uCom>${xmlEscape(unidade)}</uCom>
          <qCom>${formatNumber(qtd, 4)}</qCom>
          <vUnCom>${formatNumber(valorUnit, 10)}</vUnCom>
          <vProd>${formatNumber(valorTotal, 2)}</vProd>
          <cEANTrib>SEM GTIN</cEANTrib>
          <uTrib>${xmlEscape(unidade)}</uTrib>
          <qTrib>${formatNumber(qtd, 4)}</qTrib>
          <vUnTrib>${formatNumber(valorUnit, 10)}</vUnTrib>
          <indTot>1</indTot>
        </prod>
        <imposto>
          <ICMS>
            <ICMSSN900>
              <orig>0</orig>
              <CSOSN>900</CSOSN>
              <modBC>3</modBC>
              <vBC>0.00</vBC>
              <pICMS>0.00</pICMS>
              <vICMS>0.00</vICMS>
            </ICMSSN900>
          </ICMS>
          <PIS><PISNT><CST>07</CST></PISNT></PIS>
          <COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>
        </imposto>
      </det>
    `;
  }).join('');

  const xml = `
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe versao="4.00" Id="NFe${chave}">
        <ide>
          <cUF>${config.codigoUf}</cUF>
          <cNF>${cNF}</cNF>
          <natOp>DEVOLUCAO DE COMPRA</natOp>
          <mod>55</mod>
          <serie>${config.serie}</serie>
          <nNF>${numero}</nNF>
          <dhEmi>${dhEmi}</dhEmi>
          <dhSaiEnt>${dhEmi}</dhSaiEnt>
          <tpNF>1</tpNF>
          <idDest>${idDest}</idDest>
          <cMunFG>${config.municipioCodigo}</cMunFG>
          <tpImp>1</tpImp>
          <tpEmis>1</tpEmis>
          <cDV>${chave.slice(-1)}</cDV>
          <tpAmb>${config.ambiente}</tpAmb>
          <finNFe>4</finNFe>
          <indFinal>0</indFinal>
          <indPres>9</indPres>
          <procEmi>0</procEmi>
          <verProc>CDGestaoDev-1.0</verProc>
          <NFref><refNFe>${onlyDigits(compra.chave_acesso)}</refNFe></NFref>
        </ide>
        <emit>
          <CNPJ>${onlyDigits(config.cnpj)}</CNPJ>
          <xNome>${xmlEscape(nomeEmpresa)}</xNome>
          <xFant>${xmlEscape(xFant)}</xFant>
          <enderEmit>
            <xLgr>${xmlEscape(config.logradouro || 'ENDERECO NAO INFORMADO')}</xLgr>
            <nro>${xmlEscape((config.numero && String(config.numero).trim() !== '') ? String(config.numero).trim() : 'S/N')}</nro>
            <xBairro>${xmlEscape(config.bairro || 'CENTRO')}</xBairro>
            <cMun>${config.municipioCodigo}</cMun>
            <xMun>${xmlEscape(config.municipioNome)}</xMun>
            <UF>${xmlEscape(config.uf)}</UF>
            <CEP>${onlyDigits(config.cep)}</CEP>
            <cPais>1058</cPais>
            <xPais>BRASIL</xPais>
            <fone>${onlyDigits(config.telefone)}</fone>
          </enderEmit>
          <IE>${onlyDigits(config.ie)}</IE>
          <CRT>${config.crt}</CRT>
        </emit>
        <dest>
          <CNPJ>${cnpjFornecedor}</CNPJ>
          <xNome>${xmlEscape(compra.fornecedor)}</xNome>
          <enderDest>
            <xLgr>${xmlEscape(compra.rua || 'ENDERECO NAO INFORMADO')}</xLgr>
            <nro>${xmlEscape((compra.numero && String(compra.numero).trim() !== '') ? String(compra.numero).trim() : 'S/N')}</nro>
            <xBairro>${xmlEscape(compra.bairro || 'CENTRO')}</xBairro>
            <cMun>${config.municipioCodigo}</cMun>
            <xMun>${xmlEscape(compra.cidade || config.municipioNome)}</xMun>
            <UF>${xmlEscape((compra.uf || config.uf || 'CE').toUpperCase())}</UF>
            <CEP>${onlyDigits(compra.cep || config.cep)}</CEP>
            <cPais>1058</cPais>
            <xPais>BRASIL</xPais>
          </enderDest>
          <indIEDest>2</indIEDest>
        </dest>
        ${detXml}
        <total>
          <ICMSTot>
            <vBC>0.00</vBC>
            <vICMS>0.00</vICMS>
            <vICMSDeson>0.00</vICMSDeson>
            <vFCP>0.00</vFCP>
            <vBCST>0.00</vBCST>
            <vST>0.00</vST>
            <vFCPST>0.00</vFCPST>
            <vFCPSTRet>0.00</vFCPSTRet>
            <vProd>${formatNumber(totalProdutos, 2)}</vProd>
            <vFrete>0.00</vFrete>
            <vSeg>0.00</vSeg>
            <vDesc>0.00</vDesc>
            <vII>0.00</vII>
            <vIPI>0.00</vIPI>
            <vIPIDevol>0.00</vIPIDevol>
            <vPIS>0.00</vPIS>
            <vCOFINS>0.00</vCOFINS>
            <vOutro>0.00</vOutro>
            <vNF>${formatNumber(totalProdutos, 2)}</vNF>
          </ICMSTot>
        </total>
        <transp><modFrete>9</modFrete></transp>
        <pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>
        <infAdic>
          <infCpl>${xmlEscape(`Devolução referente à NF-e ${onlyDigits(compra.chave_acesso)}. Compra interna #${compra.id}.`)}</infCpl>
        </infAdic>
      </infNFe>
    </NFe>
  `;

  return { chave, xmlSemAssinatura: compactarXml(xml), totalProdutos };
}

async function emitirNFeDevolucaoCompra(compraId) {
  await garantirTabelas();

  const existente = await new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM nfe_devolucoes_compra
      WHERE compra_id = ? AND status IN ('autorizada','pendente','soap_enviado')
      ORDER BY id DESC LIMIT 1
    `, [compraId], (err, row) => err ? reject(err) : resolve(row));
  });

  if (existente) {
    return { reused: true, ...existente };
  }

  const config = await getFiscalConfigNfe();
  require('./nfeAmbienteGuard').assertAmbienteNfePermitido(config.ambiente, 'devolucao_compra');
  const { compra, itens } = await carregarCompra(compraId);
  const numero = await proximoNumeroNFeDevolucao();

  const xmlBase = buildXmlNFeDevolucao({ config, compra, itens, numero });
  salvarDebug('01-nfe-devolucao-original.xml', xmlBase.xmlSemAssinatura);

  const certificado = carregarCertificadoPfx(config.certificadoPath, config.certificadoSenha);
  const assinatura = assinarNFe(xmlBase.xmlSemAssinatura, certificado.privateKeyPem, certificado.certPem);
  const xmlAssinado = compactarXml(assinatura.xmlAssinado);
  salvarDebug('02-nfe-devolucao-assinada.xml', xmlAssinado);

  const { validarXmlNFe } = require("./xmlValidator");

  const validacao = validarXmlNFe(xmlAssinado, "devolucao-compra.xml");

  if (!validacao.valido) {
    console.error("XML inválido antes do envio:", validacao);

    return {
      sucesso: false,
      etapa: validacao.etapa,
      mensagem: "XML inválido antes de enviar para SEFAZ.",
      erros: validacao.erros,
      xmlDebug: validacao.caminhoDebug,
    };
  }

  const loteXml = montarLote(xmlAssinado, String(numero));
  const url = getUrlNFe55(config);

  const soapResponse = await enviarLote({
    url,
    loteXml,
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha,
    cUF: config.codigoUf,
    versaoDados: '4.00'
  });

  const raw = String(soapResponse.raw || soapResponse.message || '');
  salvarDebug('03-retorno-nfe-devolucao.xml', raw);

  let status = 'pendente';
  let protocolo = null;
  let cStat = null;
  let xMotivo = null;

  const cStatMatch = raw.match(/<cStat>(\d+)<\/cStat>/);
  const xMotivoMatch = raw.match(/<xMotivo>(.*?)<\/xMotivo>/);

  if (cStatMatch) cStat = cStatMatch[1];
  if (xMotivoMatch) xMotivo = xMotivoMatch[1];

  if (raw.includes('<cStat>100</cStat>')) {
    status = 'autorizada';
    protocolo = (raw.match(/<nProt>(.*?)<\/nProt>/) || [])[1] || null;
  } else if (raw.includes('<cStat>')) {
    status = 'rejeitada';
  } else {
    status = soapResponse.status || 'erro_transmissao';
  }

  const idNota = await new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO nfe_devolucoes_compra (
        compra_id, numero, serie, chave_acesso, protocolo, ambiente,
        status, xml_enviado, xml_retorno, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      compraId,
      numero,
      config.serie,
      xmlBase.chave,
      protocolo,
      config.ambiente,
      status,
      xmlAssinado,
      raw
    ], function(err) {
      if (err) return reject(err);
      resolve(this.lastID);
    });
  });

  return {
    success: status === 'autorizada',
    idNota,
    status,
    numero,
    serie: config.serie,
    chave: xmlBase.chave,
    protocolo,
    cStat,
    xMotivo,
    retorno: raw
  };
}

module.exports = {
  emitirNFeDevolucaoCompra
};