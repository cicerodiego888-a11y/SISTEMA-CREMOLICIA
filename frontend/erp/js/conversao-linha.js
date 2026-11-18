/**
 * Fábrica → Conversão de Estoque da Linha.
 * Transfere o estoque de um produto-linha legado (ex.: "PICOLÉ LINHA CREMOSA")
 * para os sabores da Linha de Produtos. A distribuição é sempre digitada pelo
 * operador; nada é rateado. A gravação passa pelo Motor de Estoque no servidor.
 * Cada produto-linha é convertido uma única vez; depois disso ele não é vendido
 * e o que voltar de consignação antiga é saldo residual, não estoque disponível.
 */

function clEsc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clApi(method, caminho, dados) {
  return $.ajax({
    url: API_URL + caminho,
    method: method,
    contentType: 'application/json',
    data: dados ? JSON.stringify(dados) : undefined,
    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
  });
}

function clErro(err, reserva) {
  const corpo = err && err.responseJSON;
  return (corpo && (corpo.error || corpo.message)) || reserva;
}

function clRound(valor) {
  return Math.round(Number(valor || 0) * 1000) / 1000;
}

function clQtd(valor) {
  return clRound(valor).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

const CL_SITUACAO = {
  PENDENTE: { texto: 'Pendente', classe: 'bg-warning text-dark' },
  CONVERTIDO: { texto: 'Convertido', classe: 'bg-success' },
  SEM_ESTOQUE: { texto: 'Sem estoque', classe: 'bg-secondary' },
  INATIVO: { texto: 'Inativo', classe: 'bg-secondary' }
};

function clTextoSituacao(produto) {
  if (produto.situacao === 'INATIVO' && !(produto.estoque_atual > 0)) return 'Inativo / sem estoque';
  return (CL_SITUACAO[produto.situacao] || {}).texto || produto.situacao || '—';
}

function clBadgeSituacao(produto) {
  const classe = (CL_SITUACAO[produto.situacao] || {}).classe || 'bg-secondary';
  return `<span class="badge ${classe}">${clEsc(clTextoSituacao(produto))}</span>`;
}

function loadConversaoLinha() {
  window._clGrade = null;
  $('#page-content').html(`
    <div class="container mt-4 ft-pagina cl-pagina">
      <div class="mb-3">
        <h2 class="mb-1">Conversão de Estoque da Linha</h2>
        <p class="text-muted mb-0">Transfere o estoque de um produto-linha antigo para os sabores físicos da Linha. A Linha não tem estoque; cada sabor recebe exatamente a quantidade informada. Cada produto-linha é convertido uma única vez.</p>
      </div>
      <div id="cl-conteudo"><p class="text-muted">Carregando...</p></div>
    </div>
  `);

  const pagina = document.querySelector('.cl-pagina');
  pagina.addEventListener('change', (evento) => {
    const alvo = evento.target;
    if (alvo.id === 'cl-linha') clSelecionarLinha();
    else if (alvo.id === 'cl-origem') clCarregarGrade(alvo.value);
    else if (alvo.matches('[data-cl-reativar]')) clAtualizarResumo();
  });
  pagina.addEventListener('input', (evento) => {
    if (evento.target.matches('[data-cl-qtd]')) clAtualizarResumo();
  });
  pagina.addEventListener('click', (evento) => {
    const alvo = evento.target.closest ? evento.target.closest('button') : null;
    if (!alvo) return;
    if (alvo.id === 'cl-converter') clConverter();
    else if (alvo.id === 'cl-nova') loadConversaoLinha();
    else if (alvo.hasAttribute('data-cl-comprovante')) clAbrirComprovante(alvo.getAttribute('data-cl-comprovante'));
    else if (alvo.hasAttribute('data-cl-abrir')) clAbrirProdutoLinha(alvo.getAttribute('data-cl-linha'), alvo.getAttribute('data-cl-abrir'));
  });

  clCarregar();
}
window.loadConversaoLinha = loadConversaoLinha;

function clCarregar() {
  const conteudo = document.getElementById('cl-conteudo');
  clApi('GET', '/fabrica-loja/conversoes-linha')
    .done((resposta) => {
      if (!resposta || resposta.instalada === false) {
        conteudo.innerHTML = '<div class="alert alert-warning">A estrutura de conversão de estoque da Linha não está instalada neste banco.</div>';
        return;
      }
      window._clLinhas = (resposta.linhas || []).filter((linha) => (linha.produtos_legado || []).length);
      window._clConversoes = resposta.conversoes || [];
      clRenderSelecao();
    })
    .fail((err) => {
      conteudo.innerHTML = `<div class="alert alert-danger">${clEsc(clErro(err, 'Erro ao carregar as conversões.'))}</div>`;
    });
}

function clRenderSelecao() {
  const conteudo = document.getElementById('cl-conteudo');
  const linhas = window._clLinhas || [];
  conteudo.innerHTML = `
    ${clRenderPanorama()}
    <div class="ins-editor">
      ${linhas.length ? `
        <div class="ins-grade">
          <div>
            <label class="form-label" for="cl-linha">1. Linha de Produtos</label>
            <select class="form-select" id="cl-linha">
              <option value="">Selecione a Linha...</option>
              ${linhas.map((linha) => `<option value="${Number(linha.id)}">${clEsc(linha.nome)}${linha.codigo ? ' (' + clEsc(linha.codigo) + ')' : ''}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label" for="cl-origem">2. Produto-Linha (origem)</label>
            <select class="form-select" id="cl-origem" disabled>
              <option value="">Selecione a Linha primeiro</option>
            </select>
          </div>
        </div>
      ` : '<p class="text-muted mb-0">Nenhum produto-linha legado está vinculado a uma Linha de Produtos.</p>'}
    </div>
    <div id="cl-grade"></div>
    ${clRenderHistorico()}
  `;
}

function clRenderPanorama() {
  const itens = [];
  (window._clLinhas || []).forEach((linha) => {
    (linha.produtos_legado || []).forEach((produto) => itens.push({ linha, produto }));
  });
  if (!itens.length) return '';
  return `
    <h5>Produtos-linha legados</h5>
    <div class="ins-tabela-card table-responsive mb-3">
      <table class="table table-sm align-middle ins-tabela mb-0">
        <thead>
          <tr>
            <th>Linha</th>
            <th>Produto-linha</th>
            <th>Status</th>
            <th class="text-end">Estoque disponível</th>
            <th class="text-end">Saldo residual</th>
            <th class="text-end">Pendência de consignação</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${itens.map(({ linha, produto }) => `
            <tr>
              <td>${clEsc(linha.nome)}</td>
              <td>${Number(produto.id)} · ${clEsc(produto.nome)}</td>
              <td>${clBadgeSituacao(produto)}</td>
              <td class="text-end text-nowrap">${clQtd(produto.estoque_disponivel)}</td>
              <td class="text-end text-nowrap">${produto.situacao === 'CONVERTIDO' ? clQtd(produto.saldo_residual) : '—'}</td>
              <td class="text-end text-nowrap">${produto.consignacao_pendente > 0 ? clQtd(produto.consignacao_pendente) + ' un' : '—'}</td>
              <td class="text-end text-nowrap">
                ${produto.conversao_id ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-cl-comprovante="${Number(produto.conversao_id)}">Comprovante</button>` : ''}
                <button type="button" class="btn btn-sm btn-outline-primary" data-cl-linha="${Number(linha.id)}" data-cl-abrir="${Number(produto.id)}">Abrir</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function clRenderHistorico() {
  const conversoes = window._clConversoes || [];
  return `
    <h5 class="mt-4">Conversões realizadas</h5>
    ${conversoes.length ? `
      <div class="ins-tabela-card table-responsive">
        <table class="table table-sm align-middle ins-tabela mb-0">
          <thead><tr><th>Data</th><th>Linha</th><th>Origem</th><th class="text-end">Quantidade</th><th>Correlation ID</th><th></th></tr></thead>
          <tbody>
            ${conversoes.map((c) => `
              <tr>
                <td class="text-nowrap">${clEsc(c.created_at || '')}</td>
                <td>${clEsc(c.linha_nome)}</td>
                <td>${Number(c.produto_origem_id)} · ${clEsc(c.produto_origem_nome)}</td>
                <td class="text-end text-nowrap">${clQtd(c.quantidade_total)}</td>
                <td class="text-nowrap small">${clEsc(c.correlation_id)}</td>
                <td class="text-end"><button type="button" class="btn btn-sm btn-outline-secondary" data-cl-comprovante="${Number(c.id)}">Comprovante</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '<div class="ins-tabela-card"><p class="text-muted mb-0 p-3">Nenhuma conversão realizada.</p></div>'}
  `;
}

function clAbrirProdutoLinha(linhaId, produtoId) {
  const linha = document.getElementById('cl-linha');
  if (!linha) return;
  linha.value = String(linhaId);
  clSelecionarLinha();
  const origem = document.getElementById('cl-origem');
  origem.value = String(produtoId);
  clCarregarGrade(produtoId);
  linha.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function clSelecionarLinha() {
  const linhaId = document.getElementById('cl-linha').value;
  const select = document.getElementById('cl-origem');
  document.getElementById('cl-grade').innerHTML = '';
  window._clGrade = null;
  const linha = (window._clLinhas || []).find((item) => String(item.id) === String(linhaId));
  if (!linha) {
    select.disabled = true;
    select.innerHTML = '<option value="">Selecione a Linha primeiro</option>';
    return;
  }
  select.disabled = false;
  select.innerHTML = '<option value="">Selecione o produto-linha...</option>' + linha.produtos_legado.map((p) => `
    <option value="${Number(p.id)}">${Number(p.id)} · ${clEsc(p.nome)} — ${clEsc(clTextoSituacao(p))}</option>
  `).join('');
  if (linha.produtos_legado.length === 1) {
    select.value = String(linha.produtos_legado[0].id);
    clCarregarGrade(select.value);
  }
}

function clCarregarGrade(produtoId) {
  const destino = document.getElementById('cl-grade');
  window._clGrade = null;
  if (!produtoId) {
    destino.innerHTML = '';
    return;
  }
  destino.innerHTML = '<p class="text-muted">Carregando...</p>';
  clApi('GET', '/fabrica-loja/conversoes-linha/origem/' + produtoId)
    .done((resposta) => {
      window._clGrade = resposta && resposta.grade;
      clRenderGrade();
    })
    .fail((err) => {
      destino.innerHTML = `<div class="alert alert-danger">${clEsc(clErro(err, 'Não foi possível carregar a grade de sabores.'))}</div>`;
    });
}

function clRenderCabecalhoOrigem(grade) {
  const origem = grade.origem;
  const convertido = origem.situacao === 'CONVERTIDO';
  return `
    <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
      <div>
        <div class="small text-muted">Linha ${clEsc(grade.linha.nome)}${grade.linha.codigo ? ' · ' + clEsc(grade.linha.codigo) : ''}</div>
        <h5 class="mb-1">${Number(origem.id)} · ${clEsc(origem.nome)}</h5>
        <div>Status: ${clBadgeSituacao(origem)}</div>
        ${convertido ? `<div class="small text-muted mt-1">Correlation ID: ${clEsc(grade.correlation_id)}</div>` : ''}
      </div>
      <div class="cl-resumo">
        <div><span>Estoque disponível</span><strong>${clQtd(origem.estoque_disponivel)} ${clEsc(origem.unidade)}</strong>
          ${convertido ? '' : `<small>F ${clQtd(origem.saldo_fiscal)} · NF ${clQtd(origem.saldo_nao_fiscal)}</small>`}</div>
        ${convertido ? `<div><span>Saldo residual</span><strong>${clQtd(origem.saldo_residual)}</strong><small>devolvido de consignação antiga</small></div>` : ''}
        <div class="cl-resumo__pendencia"><span>Pendência de consignação</span><strong>${clQtd(origem.consignacao_pendente)} unidades</strong>
          <small>${Number(origem.consignacao_itens || 0)} item(ns) em consignação aberta · não é estoque</small></div>
      </div>
    </div>
  `;
}

function clRenderGrade() {
  const grade = window._clGrade;
  const destino = document.getElementById('cl-grade');
  if (!grade) return;
  const origem = grade.origem;

  if (!origem.convertivel) {
    const conversao = (grade.conversoes || [])[0];
    destino.innerHTML = `
      <div class="ins-editor">
        ${clRenderCabecalhoOrigem(grade)}
        <div class="alert ${origem.situacao === 'CONVERTIDO' ? 'alert-success' : 'alert-secondary'} mb-2">
          <strong>${clEsc(origem.bloqueio ? origem.bloqueio.mensagem : 'Conversão indisponível.')}</strong>
          ${origem.situacao === 'CONVERTIDO' ? '<div class="small mt-1">O produto-linha não pode mais ser vendido. Consignações antigas continuam com devolução e acerto normais; o que voltar fica como saldo residual e não reabre a conversão.</div>' : ''}
        </div>
        <div class="d-flex justify-content-end gap-2">
          ${conversao ? `<button type="button" class="btn btn-outline-secondary" data-cl-comprovante="${Number(conversao.id)}">Ver comprovante</button>` : ''}
          <button type="button" class="btn btn-success" id="cl-converter" disabled>Converter Estoque</button>
        </div>
      </div>
    `;
    return;
  }

  const bloqueados = grade.sabores.filter((s) => !s.apto);
  const avisos = [];
  if (grade.consignacoes_em_aberto.itens > 0) {
    avisos.push(`Há ${grade.consignacoes_em_aberto.itens} item(ns) de consignação em aberto com este produto-linha (${clQtd(grade.consignacoes_em_aberto.quantidade)} pendente). Essa pendência não entra na conversão; o que voltar depois fica como saldo residual do produto-linha.`);
  }
  if (bloqueados.length) {
    avisos.push(`${bloqueados.length} sabor(es) sem natureza PRODUZIDO não podem receber estoque. Classifique-os em Cadastros → Produtos, campo "Natureza do cadastro".`);
  }

  destino.innerHTML = `
    <div class="ins-editor">
      ${clRenderCabecalhoOrigem(grade)}
      <div class="alert alert-warning py-2 mb-2"><strong>${clEsc(origem.aviso || '')}</strong></div>
      ${avisos.map((texto) => `<div class="alert alert-light border py-2 small mb-2">${clEsc(texto)}</div>`).join('')}
      ${grade.sabores.length ? `
        <div class="ins-tabela-card table-responsive">
          <table class="table table-sm align-middle ins-tabela mb-0">
            <thead>
              <tr>
                <th>Sabor</th>
                <th>Situação</th>
                <th class="text-end">Estoque atual</th>
                <th class="text-end">Fiscal</th>
                <th class="text-end">Não fiscal</th>
                <th class="text-end">Total</th>
                <th class="text-center">Reativar</th>
              </tr>
            </thead>
            <tbody>
              ${grade.sabores.map((s) => `
                <tr data-cl-sabor="${Number(s.id)}" data-cl-inativo="${s.ativo ? '0' : '1'}" class="${s.apto ? '' : 'text-muted'}">
                  <td>
                    <div>${Number(s.id)} · ${clEsc(s.nome)}</div>
                    ${s.apto ? '' : `<div class="small text-danger">${clEsc(s.motivo_bloqueio)}</div>`}
                  </td>
                  <td>${s.ativo ? '<span class="badge bg-success">Ativo</span>' : '<span class="badge bg-secondary">Inativo</span>'}</td>
                  <td class="text-end text-nowrap">${clQtd(s.estoque_atual)}</td>
                  <td class="text-end"><input type="number" class="form-control form-control-sm cl-input" min="0" step="0.001" data-cl-qtd="fiscal" aria-label="Fiscal — ${clEsc(s.nome)}" ${s.apto ? '' : 'disabled'}></td>
                  <td class="text-end"><input type="number" class="form-control form-control-sm cl-input" min="0" step="0.001" data-cl-qtd="nao_fiscal" aria-label="Não fiscal — ${clEsc(s.nome)}" ${s.apto ? '' : 'disabled'}></td>
                  <td class="text-end text-nowrap" data-cl-total>0</td>
                  <td class="text-center">${s.ativo ? '<span class="small text-muted">—</span>' : `<input type="checkbox" class="form-check-input" data-cl-reativar aria-label="Reativar ${clEsc(s.nome)}" ${s.apto ? '' : 'disabled'} title="Reativar este sabor ao receber estoque">`}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="cl-totais mt-3" id="cl-totais"></div>
        <div class="mt-3">
          <label class="form-label" for="cl-observacao">Observação</label>
          <input class="form-control" id="cl-observacao" maxlength="200" placeholder="Ex.: contagem física de 07/10">
        </div>
        <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap mt-3">
          <div id="cl-conferencia" class="small"></div>
          <button type="button" class="btn btn-success" id="cl-converter" disabled>Converter Estoque</button>
        </div>
      ` : '<p class="text-muted mb-0">Esta Linha não possui sabores cadastrados.</p>'}
    </div>
  `;
  clAtualizarResumo();
}

function clLerDistribuicao() {
  return Array.from(document.querySelectorAll('[data-cl-sabor]')).map((tr) => {
    const fiscalEl = tr.querySelector('[data-cl-qtd="fiscal"]');
    const naoFiscalEl = tr.querySelector('[data-cl-qtd="nao_fiscal"]');
    const reativarEl = tr.querySelector('[data-cl-reativar]');
    const fiscal = fiscalEl && fiscalEl.value !== '' ? Number(fiscalEl.value) : 0;
    const naoFiscal = naoFiscalEl && naoFiscalEl.value !== '' ? Number(naoFiscalEl.value) : 0;
    return {
      linha: tr,
      produto_id: Number(tr.getAttribute('data-cl-sabor')),
      inativo: tr.getAttribute('data-cl-inativo') === '1',
      habilitado: !!(fiscalEl && !fiscalEl.disabled),
      quantidade_fiscal: fiscal,
      quantidade_nao_fiscal: naoFiscal,
      total: clRound(fiscal + naoFiscal),
      reativar: !!(reativarEl && reativarEl.checked),
      reativarEl
    };
  });
}

function clAtualizarResumo() {
  const grade = window._clGrade;
  const totais = document.getElementById('cl-totais');
  if (!grade || !totais) return;
  const itens = clLerDistribuicao();
  let invalido = false;
  itens.forEach((item) => {
    item.linha.querySelector('[data-cl-total]').textContent = clQtd(item.total);
    if (!Number.isFinite(item.total) || item.quantidade_fiscal < 0 || item.quantidade_nao_fiscal < 0) invalido = true;
    if (item.reativarEl && !item.reativarEl.disabled) {
      const semEstoque = !(item.total > 0);
      if (semEstoque) {
        item.reativarEl.checked = false;
        item.reativar = false;
      }
      item.reativarEl.title = semEstoque ? 'Informe uma quantidade para poder reativar' : 'Reativar este sabor ao receber estoque';
    }
  });
  const inativosSemReativar = itens.filter((item) => item.inativo && item.total > 0 && !item.reativar);
  const origem = grade.origem;
  const informadoFiscal = clRound(itens.reduce((s, i) => s + (Number.isFinite(i.quantidade_fiscal) ? i.quantidade_fiscal : 0), 0));
  const informadoNaoFiscal = clRound(itens.reduce((s, i) => s + (Number.isFinite(i.quantidade_nao_fiscal) ? i.quantidade_nao_fiscal : 0), 0));
  const informadoTotal = clRound(informadoFiscal + informadoNaoFiscal);
  const difFiscal = clRound(origem.saldo_fiscal - informadoFiscal);
  const difNaoFiscal = clRound(origem.saldo_nao_fiscal - informadoNaoFiscal);
  const difTotal = clRound(origem.estoque_disponivel - informadoTotal);
  const diferencaZerada = difFiscal === 0 && difNaoFiscal === 0 && difTotal === 0;
  const conferido = !invalido && diferencaZerada && !inativosSemReativar.length && origem.convertivel;

  totais.innerHTML = `
    <div class="cl-resumo cl-resumo--totais">
      <div><span>Estoque do produto-linha</span><strong>${clQtd(origem.estoque_disponivel)}</strong><small>F ${clQtd(origem.saldo_fiscal)} · NF ${clQtd(origem.saldo_nao_fiscal)}</small></div>
      <div><span>Total informado</span><strong>${clQtd(informadoTotal)}</strong><small>F ${clQtd(informadoFiscal)} · NF ${clQtd(informadoNaoFiscal)}</small></div>
      <div class="${diferencaZerada ? 'cl-ok' : 'cl-divergente'}"><span>Diferença</span><strong>${clQtd(difTotal)}</strong><small>F ${clQtd(difFiscal)} · NF ${clQtd(difNaoFiscal)}</small></div>
    </div>
  `;
  const conferencia = document.getElementById('cl-conferencia');
  if (conferido) {
    conferencia.innerHTML = '<span class="cl-ok fw-semibold">Distribuição conferida.</span>';
  } else if (invalido) {
    conferencia.innerHTML = '<span class="cl-divergente">Há quantidade inválida ou negativa.</span>';
  } else if (inativosSemReativar.length) {
    conferencia.innerHTML = `<span class="cl-divergente">Marque "Reativar" nos sabores inativos que recebem estoque (${inativosSemReativar.length}).</span>`;
  } else {
    conferencia.innerHTML = '<span class="text-muted">A diferença precisa ser zero (fiscal e não fiscal) para converter.</span>';
  }
  document.getElementById('cl-converter').disabled = !conferido;
}

function clConverter() {
  const grade = window._clGrade;
  if (!grade || !grade.origem.convertivel) return;
  const itens = clLerDistribuicao().filter((item) => item.habilitado && item.total > 0);
  const reativados = itens.filter((item) => item.reativar).length;
  const mensagem = `Converter ${clQtd(grade.origem.estoque_disponivel)} ${grade.origem.unidade} de "${grade.origem.nome}" para ${itens.length} sabor(es)`
    + (reativados ? `, reativando ${reativados}` : '')
    + '?\n\nO produto-linha ficará com estoque zero e não poderá mais ser vendido nem convertido de novo.';
  if (!confirm(mensagem)) return;
  const botao = document.getElementById('cl-converter');
  botao.disabled = true;
  botao.textContent = 'Convertendo...';
  clApi('POST', '/fabrica-loja/conversoes-linha', {
    linha_produtos_id: grade.linha.id,
    produto_origem_id: grade.origem.id,
    observacao: (document.getElementById('cl-observacao') || {}).value || '',
    itens: itens.map((item) => ({
      produto_id: item.produto_id,
      quantidade_fiscal: item.quantidade_fiscal,
      quantidade_nao_fiscal: item.quantidade_nao_fiscal,
      reativar: item.reativar
    }))
  })
    .done((resposta) => {
      showNotification('Conversão concluída.', 'success');
      clRenderComprovante(resposta && resposta.conversao);
    })
    .fail((err) => {
      botao.textContent = 'Converter Estoque';
      clAtualizarResumo();
      showNotification(clErro(err, 'Não foi possível converter o estoque.'), 'error');
    });
}

function clHtmlComprovante(conversao) {
  const t = conversao.totais || {};
  const itens = conversao.itens.filter((i) => i.quantidade_total > 0);
  return `
    <div class="cl-comprovante">
      <div class="cl-comprovante__titulo">CONVERSÃO DE ESTOQUE DA LINHA</div>
      <p class="small text-muted mb-3">${clEsc(conversao.descricao_operacao || 'Operação de conversão de estoque legado.')}</p>
      <dl class="cl-comprovante__dados">
        <dt>Linha</dt><dd>${clEsc(conversao.linha.nome)}</dd>
        <dt>Produto-linha</dt><dd>${Number(conversao.origem.id)} · ${clEsc(conversao.origem.nome)}</dd>
        <dt>Estoque convertido</dt><dd><strong>${clQtd(conversao.quantidade_total)}</strong></dd>
      </dl>
      <div class="fw-semibold mb-1">Distribuição</div>
      <table class="table table-sm mb-2">
        <thead><tr><th>Produto</th><th class="text-end">Fiscal</th><th class="text-end">Não Fiscal</th><th class="text-end">Total</th></tr></thead>
        <tbody>
          ${itens.map((i) => `
            <tr>
              <td>${Number(i.produto_id)} · ${clEsc(i.nome)}${i.reativado ? ' <span class="badge bg-success">reativado</span>' : ''}</td>
              <td class="text-end text-nowrap">${clQtd(i.quantidade_fiscal)}</td>
              <td class="text-end text-nowrap">${clQtd(i.quantidade_nao_fiscal)}</td>
              <td class="text-end text-nowrap fw-semibold">${clQtd(i.quantidade_total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <table class="table table-sm cl-comprovante__totais mb-3">
        <tbody>
          <tr><td>Fiscal origem</td><td class="text-end">${clQtd(t.fiscal_origem)}</td><td>Fiscal distribuído</td><td class="text-end">${clQtd(t.fiscal_distribuido)}</td></tr>
          <tr><td>Não fiscal origem</td><td class="text-end">${clQtd(t.nao_fiscal_origem)}</td><td>Não fiscal distribuído</td><td class="text-end">${clQtd(t.nao_fiscal_distribuido)}</td></tr>
          <tr class="fw-semibold"><td>Total origem</td><td class="text-end">${clQtd(t.total_origem)}</td><td>Total distribuído</td><td class="text-end">${clQtd(t.total_distribuido)}</td></tr>
        </tbody>
      </table>
      <dl class="cl-comprovante__dados">
        <dt>Status</dt><dd>${clEsc(conversao.status)}</dd>
        <dt>Correlation ID</dt><dd>${clEsc(conversao.correlation_id)}</dd>
        <dt>Data</dt><dd>${clEsc(conversao.created_at || '')}</dd>
        <dt>Usuário</dt><dd>${clEsc(conversao.usuario_nome || '—')}</dd>
        ${conversao.observacao ? `<dt>Observação</dt><dd>${clEsc(conversao.observacao)}</dd>` : ''}
        <dt>Movimentações</dt><dd>${(conversao.movimentacoes || []).length} no Motor de Estoque${(conversao.movimentacoes || []).length ? ` (#${conversao.movimentacoes[0].id} a #${conversao.movimentacoes[conversao.movimentacoes.length - 1].id})` : ''}</dd>
      </dl>
    </div>
  `;
}

function clRenderComprovante(conversao) {
  if (!conversao) {
    loadConversaoLinha();
    return;
  }
  document.getElementById('cl-conteudo').innerHTML = `
    ${clHtmlComprovante(conversao)}
    <div class="mt-3"><button type="button" class="btn btn-outline-primary" id="cl-nova">Voltar às conversões</button></div>
  `;
}

function clAbrirComprovante(id) {
  clApi('GET', '/fabrica-loja/conversoes-linha/' + id)
    .done((resposta) => clRenderComprovante(resposta && resposta.conversao))
    .fail((err) => showNotification(clErro(err, 'Não foi possível abrir o comprovante.'), 'error'));
}
