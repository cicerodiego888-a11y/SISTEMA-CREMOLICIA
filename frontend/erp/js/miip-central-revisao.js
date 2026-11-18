/**
 * Central de Revisão MIIP — Sprint 6B
 * Módulo independente do fluxo de Compras.
 *
 * Uso:
 *   MiipCentralRevisao.iniciar({ dadosImportacao, apiUrl, produtos, onConcluir, onCancelar, ... })
 */
(function initMiipCentralRevisao(global) {
  'use strict';

  const MOTOR_LABELS = {
    motor_gtin: 'Código de barras',
    motor_associacao_fornecedor: 'Histórico do fornecedor'
  };

  let estado = null;

  function atualizarCandidatoPendencia(pendencia, sugestao) {
    const produtoId = Number(sugestao?.produtoId);
    if (!sugestao?.encontrado || !Number.isFinite(produtoId) || produtoId <= 0) {
      pendencia.produtoEncontrado = null;
      pendencia.candidatoSelecionado = null;
      pendencia.score = Number(sugestao?.score || 0);
      pendencia.motor = null;
      pendencia.precisaConfirmacao = false;
      pendencia.precisaCadastro = true;
      return false;
    }

    const produto = {
      id: produtoId,
      nome: sugestao.produtoNome || '',
      codigo: sugestao.produtoCodigo || '',
      codigoBarras: sugestao.codigoBarras || null
    };
    const motor = sugestao.motor || null;

    pendencia.produtoEncontrado = produto;
    pendencia.candidatoSelecionado = {
      produtoId,
      produto,
      motoresQueVotaram: motor ? [motor] : [],
      evidencias: sugestao.motorLabel ? [{ descricao: sugestao.motorLabel }] : []
    };
    pendencia.score = Number(sugestao.score || 0);
    pendencia.motor = motor;
    pendencia.nivelCerteza = sugestao.confianca || null;
    pendencia.precisaConfirmacao = true;
    pendencia.precisaCadastro = false;
    return true;
  }

  function escapeHtml(texto) {
    return String(texto ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatarMoeda(valor) {
    const numero = Number(valor || 0);
    if (typeof formatCurrency === 'function') return formatCurrency(numero);
    return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatarTempo(ms) {
    const totalSeg = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function calcularPrecisao(resumo, confirmadosManualmente) {
    const total = Number(resumo?.totalItens ?? 0);
    if (total <= 0) return 0;
    const auto = Number(resumo?.identificadosAutomaticamente ?? 0);
    const conf = Number(confirmadosManualmente ?? 0);
    return Math.round(((auto + conf) / total) * 100);
  }

  function extrairPendencias(resultados) {
    return (resultados || []).filter((r) => r.precisaConfirmacao || r.precisaCadastro);
  }

  function ordenarPendencias(pendencias) {
    return [...pendencias].sort((a, b) => {
      const semA = Boolean(a.precisaCadastro && !a.produtoEncontrado);
      const semB = Boolean(b.precisaCadastro && !b.produtoEncontrado);
      if (semA && !semB) return 1;
      if (!semA && semB) return -1;
      return Number(b.score ?? 0) - Number(a.score ?? 0);
    });
  }

  // O MIIP só reconhece GTIN e associação de fornecedor; um insumo recém-cadastrado
  // para este item é oferecido como candidato, mas o vínculo continua exigindo confirmação.
  function aplicarProdutoRecemCadastrado(pendencia, produto, descricaoEvidencia) {
    const produtoId = Number(produto?.id);
    if (!Number.isFinite(produtoId) || produtoId <= 0) return false;

    const candidato = {
      id: produtoId,
      nome: produto.nome || '',
      codigo: produto.codigo || '',
      codigoBarras: produto.codigo_barras || null
    };
    pendencia.produtoEncontrado = candidato;
    pendencia.candidatoSelecionado = {
      produtoId,
      produto: candidato,
      motoresQueVotaram: [],
      evidencias: [{ descricao: descricaoEvidencia || 'Produto cadastrado agora para este item' }]
    };
    pendencia.score = 0;
    pendencia.motor = null;
    pendencia.precisaConfirmacao = true;
    pendencia.precisaCadastro = false;
    return true;
  }

  function normalizarNome(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
  }

  // Quando o MIIP não reconhece o item, procura no cadastro de produtos já carregado
  // (mesma fonte da pesquisa F2) por código de barras ou nome idêntico. Só sugere se for único.
  function sugerirProdutoCadastrado(pendencia, produtos, item) {
    const lista = (produtos || []).filter((p) => !(p.ativo === 0 || p.ativo === '0' || p.ativo === false));
    const barras = String(item?.codigo_barras || item?.codigoBarras || '').replace(/\s+/g, '');
    if (/^\d{8,14}$/.test(barras)) {
      const porBarras = lista.filter((p) => String(p.codigo_barras || '').replace(/\s+/g, '') === barras);
      if (porBarras.length === 1) {
        return aplicarProdutoRecemCadastrado(pendencia, porBarras[0], 'Mesmo código de barras do cadastro');
      }
      if (porBarras.length > 1) return false;
    }

    const nome = normalizarNome(item?.produto_nome);
    if (!nome) return false;
    const porNome = lista.filter((p) => normalizarNome(p.nome) === nome);
    if (porNome.length !== 1) return false;
    return aplicarProdutoRecemCadastrado(pendencia, porNome[0], 'Nome idêntico ao produto cadastrado');
  }

  function extrairEvidencias(candidato, motor) {
    const lista = [];
    if (motor && MOTOR_LABELS[motor]) lista.push(MOTOR_LABELS[motor]);
    (candidato?.evidencias || []).forEach((ev) => {
      const t = ev?.descricao || ev?.tipo || ev?.valor;
      if (t && !lista.includes(t)) lista.push(String(t));
    });
    if (candidato?.produto?.marca && !lista.includes('Marca')) lista.push('Marca');
    return lista;
  }

  function montarSessao(dadosImportacao) {
    const miip = dadosImportacao?.miip_importacao || {};
    const resultados = miip.resultados || [];
    const itens = (dadosImportacao?.itens || []).map((item) => ({ ...item }));

    return {
      dadosImportacao,
      operacaoId: miip.operacaoId || dadosImportacao?.chave_acesso || null,
      resumo: {
        totalItens: Number(miip.resumo?.totalItens ?? itens.length),
        identificadosAutomaticamente: Number(miip.resumo?.identificadosAutomaticamente ?? 0),
        precisamConfirmacao: Number(miip.resumo?.precisamConfirmacao ?? 0),
        precisamCadastro: Number(miip.resumo?.precisamCadastro ?? 0),
        tempoProcessamento: Number(miip.resumo?.tempoProcessamento ?? 0)
      },
      fornecedor: dadosImportacao?.fornecedor || '',
      fornecedorCnpj: dadosImportacao?.fornecedor_cnpj || '',
      pendencias: ordenarPendencias(extrairPendencias(resultados)),
      itens,
      indiceAtual: 0,
      resolvidas: [],
      ignoradas: [],
      aprendizados: 0,
      confirmadosManualmente: 0,
      fase: 'revisao'
    };
  }

  function pendenciaAberta(sessao, pendencia) {
    return !sessao.resolvidas.includes(pendencia.indice)
      && !sessao.ignoradas.includes(pendencia.indice);
  }

  function contarAbertas(sessao) {
    return sessao.pendencias.filter((p) => pendenciaAberta(sessao, p)).length;
  }

  function proximaAberta(sessao, direcao) {
    const total = sessao.pendencias.length;
    let idx = sessao.indiceAtual;
    for (let i = 0; i < total; i += 1) {
      idx = (idx + direcao + total) % total;
      if (pendenciaAberta(sessao, sessao.pendencias[idx])) {
        sessao.indiceAtual = idx;
        return;
      }
    }
  }

  function notificar(mensagem, tipo) {
    if (typeof showNotification === 'function') {
      showNotification(mensagem, tipo || 'info');
    }
  }

  function mostrarAprendizado() {
    const toast = document.getElementById('miipCentralAprendizadoToast');
    if (!toast) return;
    toast.classList.add('miip-central-toast--visivel');
    setTimeout(() => toast.classList.remove('miip-central-toast--visivel'), 4200);
  }

  function enviarAprendizado(pendencia, produtoId, produto) {
    const { opcoes, sessao } = estado;
    const item = sessao.itens[pendencia.indice] || pendencia.produtoXML || {};
    const usuario = opcoes.obterUsuario ? opcoes.obterUsuario() : null;
    const fornecedorCnpj = sessao.fornecedorCnpj;

    if (!fornecedorCnpj || !item.codigo_fornecedor) return Promise.resolve(false);

    return $.ajax({
      url: `${opcoes.apiUrl}/miip/feedback`,
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        confirmado: true,
        produtoId: Number(produtoId),
        fornecedorCnpj,
        codigoFornecedor: item.codigo_fornecedor,
        fornecedorNome: sessao.fornecedor,
        nomeItem: item.produto_nome,
        codigoBarras: item.codigo_barras,
        ncm: item.ncm,
        unidade: item.unidade,
        usuarioId: usuario?.id ?? null,
        operacaoId: pendencia.operacaoId || sessao.operacaoId,
        origem: 'central_revisao_miip',
        item
      })
    }).then(() => true).catch(() => false);
  }

  function renderResumoTopo(sessao) {
    const precisao = calcularPrecisao(sessao.resumo, sessao.confirmadosManualmente);
    return `
      <div class="miip-central-resumo-grid">
        <div class="miip-central-metrica"><span>Itens da Nota</span><strong>${sessao.resumo.totalItens}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--ok"><span>Associados automaticamente</span><strong>${sessao.resumo.identificadosAutomaticamente}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--warn"><span>Precisam confirmação</span><strong>${sessao.resumo.precisamConfirmacao}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--alert"><span>Precisam cadastro</span><strong>${sessao.resumo.precisamCadastro}</strong></div>
        <div class="miip-central-metrica"><span>Precisão desta importação</span><strong>${precisao}%</strong></div>
        <div class="miip-central-metrica"><span>Tempo de processamento</span><strong>${formatarTempo(sessao.resumo.tempoProcessamento)}</strong></div>
      </div>
    `;
  }

  function statusPendencia(sessao, pendencia) {
    if (sessao.resolvidas.includes(pendencia.indice)) return 'resolvida';
    if (sessao.ignoradas.includes(pendencia.indice)) return 'ignorada';
    return 'aberta';
  }

  function renderListaPendencias(sessao) {
    return sessao.pendencias.map((pendencia, idx) => {
      const status = statusPendencia(sessao, pendencia);
      const ativo = idx === sessao.indiceAtual ? ' miip-central-lista-item--ativo' : '';
      const tipo = pendencia.precisaCadastro && !pendencia.produtoEncontrado ? 'cadastro' : 'confirmacao';
      const nome = pendencia.produtoXML?.produto_nome || 'Item sem nome';
      const score = Number(pendencia.score ?? 0);

      return `
        <button type="button" class="miip-central-lista-item${ativo}" data-lista-idx="${idx}">
          <div class="miip-central-lista-titulo">${escapeHtml(nome)}</div>
          <div class="miip-central-lista-meta">
            <span class="miip-central-tag miip-central-tag--${tipo}">${tipo === 'cadastro' ? 'Cadastro' : 'Confirmação'}</span>
            <span>${score > 0 ? `${score}%` : (pendencia.produtoEncontrado ? 'Sugestão do cadastro' : 'Sem candidato')}</span>
            ${status === 'resolvida' ? '<i class="fas fa-check-circle text-success"></i>' : ''}
            ${status === 'ignorada' ? '<i class="fas fa-ban text-muted"></i>' : ''}
          </div>
        </button>
      `;
    }).join('');
  }

  function linhaInfo(rotulo, valor) {
    if (valor === null || valor === undefined || String(valor).trim() === '') return '';
    return `<dt>${escapeHtml(rotulo)}</dt><dd>${escapeHtml(valor)}</dd>`;
  }

  // Completa o candidato com os dados do cadastro de produtos já carregado.
  function dadosCompletosProduto(produto) {
    const lista = estado?.opcoes?.produtos || [];
    const completo = lista.find((p) => String(p.id) === String(produto.id)) || {};
    return { ...completo, ...Object.fromEntries(Object.entries(produto).filter(([, v]) => v !== null && v !== '')) };
  }

  function renderInfoProduto(produto) {
    const p = dadosCompletosProduto(produto);
    const custo = Number(p.preco_compra);
    return `<dl class="miip-central-dl">
      ${linhaInfo('Código', p.codigo)}
      ${linhaInfo('Código de barras', p.codigo_barras || p.codigoBarras)}
      ${linhaInfo('Unidade', p.unidade)}
      ${linhaInfo('NCM', p.ncm)}
      ${linhaInfo('Marca', p.marca)}
      ${linhaInfo('Fornecedor', p.fornecedor)}
      ${Number.isFinite(custo) && custo > 0 ? `<dt>Custo de compra</dt><dd>${formatarMoeda(custo)}</dd>` : ''}
    </dl>`;
  }

  function renderDetalhes(pendencia, sessao) {
    const xml = pendencia.produtoXML || sessao.itens[pendencia.indice] || {};
    return `
      <div class="miip-central-detalhe-bloco">
        <h6>Produto do XML</h6>
        <p class="miip-central-detalhe-nome">${escapeHtml(xml.produto_nome || '-')}</p>
        <dl class="miip-central-dl">
          <dt>Fornecedor</dt><dd>${escapeHtml(sessao.fornecedor || '-')}</dd>
          <dt>Código fornecedor</dt><dd>${escapeHtml(xml.codigo_fornecedor || '-')}</dd>
          <dt>Quantidade</dt><dd>${escapeHtml(xml.quantidade ?? '-')} ${escapeHtml(xml.unidade || '')}</dd>
          <dt>Valor</dt><dd>${formatarMoeda(xml.preco_unitario || xml.subtotal)}</dd>
          ${linhaInfo('Código de barras', xml.codigo_barras || xml.codigoBarras)}
          ${linhaInfo('NCM', xml.ncm)}
          ${linhaInfo('CFOP', xml.cfop)}
          <dt>Descrição completa</dt><dd>${escapeHtml(xml.produto_nome || '-')}</dd>
        </dl>
      </div>
    `;
  }

  function renderCandidato(pendencia) {
    const produto = pendencia.produtoEncontrado;
    if (!produto) {
      return `
        <div class="miip-central-candidato miip-central-candidato--vazio">
          <h6>Melhor candidato</h6>
          <p>Nenhum candidato confiável encontrado. Cadastre um novo produto ou escolha manualmente.</p>
        </div>
      `;
    }

    const score = Number(pendencia.score ?? 0);
    const evidencias = extrairEvidencias(pendencia.candidatoSelecionado, pendencia.motor);

    return `
      <div class="miip-central-candidato">
        <h6>Produto CDS</h6>
        <p class="miip-central-candidato-nome">${escapeHtml(produto.nome || '-')}</p>
        ${renderInfoProduto(produto)}
        ${score > 0 ? `<div class="miip-central-candidato-score">
          <span>Nível de Certeza</span>
          <strong>${score}%</strong>
        </div>` : ''}
        <div class="miip-central-evidencias">
          <span>Baseado em</span>
          <ul>${evidencias.map((ev) => `<li><i class="fas fa-check"></i> ${escapeHtml(ev)}</li>`).join('')}</ul>
        </div>
      </div>
    `;
  }

  function renderTelaRevisao() {
    const { sessao } = estado;
    const pendencia = sessao.pendencias[sessao.indiceAtual];
    const abertas = contarAbertas(sessao);

    $('#miipCentralResumo').html(renderResumoTopo(sessao));
    $('#miipCentralLista').html(renderListaPendencias(sessao));
    $('#miipCentralDetalhes').html(renderDetalhes(pendencia, sessao));
    $('#miipCentralCandidato').html(renderCandidato(pendencia));
    $('#miipCentralContador').text(`${sessao.indiceAtual + 1} / ${sessao.pendencias.length} pendências (${abertas} abertas)`);

    if (abertas === 0) {
      renderTelaFinal();
    }
  }

  function renderTelaFinal() {
    const { sessao } = estado;
    sessao.fase = 'final';
    const precisao = calcularPrecisao(sessao.resumo, sessao.confirmadosManualmente);

    $('#miipCentralCorpo').html(`
      <div class="miip-central-final">
        ${renderResumoTopo(sessao)}
        <div class="miip-central-final-msg">
          <i class="fas fa-check-circle"></i>
          <h4>Importação concluída.</h4>
          <p>MIIP identificou automaticamente: <strong>${sessao.resumo.identificadosAutomaticamente}</strong> produtos</p>
          <p>Aprendeu: <strong>${sessao.aprendizados}</strong> novas associações.</p>
          <p>Precisão desta importação: <strong>${precisao}%</strong></p>
          <p class="miip-central-final-sub">Agora a compra será aberta para conferência final.</p>
          <button type="button" class="btn btn-primary btn-lg" id="miipCentralBtnConcluir">Abrir tela de Compras</button>
        </div>
      </div>
    `);
  }

  function renderSemPendencias() {
    const { sessao } = estado;
    sessao.fase = 'final';
    renderTelaFinal();
  }

  function renderModal() {
    const html = `
      <div class="modal fade miip-central-modal" id="miipCentralRevisaoModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
        <div class="modal-dialog modal-fullscreen">
          <div class="modal-content miip-central-content">
            <div class="modal-header miip-central-header">
              <div>
                <h5 class="modal-title"><i class="fas fa-robot"></i> Central de Revisão MIIP</h5>
                <small id="miipCentralContador" class="text-muted"></small>
              </div>
              <button type="button" class="btn btn-sm btn-outline-light" id="miipCentralBtnCancelar" title="ESC — Cancelar revisão">
                <i class="fas fa-times"></i> Cancelar (ESC)
              </button>
            </div>
            <div class="modal-body p-0" id="miipCentralCorpo">
              <div id="miipCentralResumo" class="miip-central-resumo"></div>
              <div class="miip-central-layout">
                <aside class="miip-central-lista" id="miipCentralLista"></aside>
                <section class="miip-central-painel">
                  <div id="miipCentralDetalhes"></div>
                  <div id="miipCentralCandidato"></div>
                  <div class="miip-central-acoes">
                    <button type="button" class="btn btn-success" id="miipCentralBtnConfirmar"><i class="fas fa-check"></i> Confirmar Produto <small>(Enter)</small></button>
                    <button type="button" class="btn btn-primary" id="miipCentralBtnEscolher"><i class="fas fa-search"></i> Escolher outro <small>(F2)</small></button>
                    <button type="button" class="btn btn-warning" id="miipCentralBtnCadastrar"><i class="fas fa-plus"></i> Cadastrar Novo <small>(F3)</small></button>
                    <button type="button" class="btn btn-outline-secondary" id="miipCentralBtnIgnorar"><i class="fas fa-ban"></i> Ignorar Item</button>
                  </div>
                  <div class="miip-central-atalhos">
                    <span><kbd>Enter</kbd> Confirmar</span>
                    <span><kbd>Tab</kbd> Próximo</span>
                    <span><kbd>Shift</kbd>+<kbd>Tab</kbd> Anterior</span>
                    <span><kbd>F2</kbd> Pesquisar</span>
                    <span><kbd>F3</kbd> Cadastrar</span>
                    <span><kbd>Esc</kbd> Cancelar</span>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="miipCentralAprendizadoToast" class="miip-central-toast">
        <i class="fas fa-check"></i>
        <div>
          <strong>MIIP aprendeu esta associação.</strong>
          <span>Próximas importações serão automáticas.</span>
        </div>
      </div>
      <div class="modal fade" id="miipCentralBuscaModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Pesquisar produto (F2)</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
              <input type="text" class="form-control mb-2" id="miipCentralBuscaInput" placeholder="Nome, código ou GTIN...">
              <div id="miipCentralBuscaResultados" class="miip-central-busca-lista"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    $('#miipCentralRevisaoRoot').remove();
    $('body').append(`<div id="miipCentralRevisaoRoot">${html}</div>`);
  }

  function abrirModal() {
    renderModal();
    const modal = new bootstrap.Modal(document.getElementById('miipCentralRevisaoModal'));
    estado.modal = modal;
    modal.show();
    bindEventos();
  }

  function fecharModal() {
    if (estado?.modal) estado.modal.hide();
    $('#miipCentralRevisaoRoot').remove();
    $(document).off('.miipCentral');
  }

  function confirmarAtual() {
    const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
    if (!pendencia || !pendenciaAberta(estado.sessao, pendencia)) return;

    const produtoId = pendencia.produtoEncontrado?.id;
    if (!produtoId) {
      notificar('Nenhum candidato para confirmar. Use F2 ou cadastre um novo produto.', 'warning');
      return;
    }

    aplicarConfirmacao(pendencia, produtoId, pendencia.produtoEncontrado);
  }

  function aplicarConfirmacao(pendencia, produtoId, produto, aprendeuExplicito) {
    const item = estado.sessao.itens[pendencia.indice];
    if (item) {
      item.produto_id = Number(produtoId);
      item.miip_revisao_status = 'confirmado';
    }

    estado.sessao.resolvidas.push(pendencia.indice);
    estado.sessao.confirmadosManualmente += 1;

    const promessa = aprendeuExplicito === false
      ? Promise.resolve(false)
      : enviarAprendizado(pendencia, produtoId, produto);

    promessa.then((aprendeu) => {
      if (aprendeu) {
        estado.sessao.aprendizados += 1;
        mostrarAprendizado();
      }
      proximaAberta(estado.sessao, 1);
      renderTelaRevisao();
    });
  }

  function ignorarAtual() {
    const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
    if (!pendencia || !pendenciaAberta(estado.sessao, pendencia)) return;
    estado.sessao.ignoradas.push(pendencia.indice);
    proximaAberta(estado.sessao, 1);
    renderTelaRevisao();
  }

  function abrirBuscaProduto() {
    const produtos = estado.opcoes.produtos || [];
    const modalEl = document.getElementById('miipCentralBuscaModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const renderBusca = (termo) => {
      const lower = String(termo || '').toLowerCase().trim();
      const filtrados = produtos.filter((p) => {
        if (!lower) return true;
        return String(p.nome || '').toLowerCase().includes(lower)
          || String(p.codigo || '').includes(lower)
          || String(p.codigo_barras || '').includes(lower);
      }).slice(0, 30);

      $('#miipCentralBuscaResultados').html(filtrados.map((p) => `
        <button type="button" class="miip-central-busca-item" data-produto-id="${p.id}">
          <strong>${escapeHtml(p.nome)}</strong>
          <small>${escapeHtml(p.codigo_barras || p.codigo || '')}</small>
        </button>
      `).join('') || '<p class="text-muted p-2">Nenhum produto encontrado.</p>');
    };

    $('#miipCentralBuscaInput').val('').off('input.miip').on('input.miip', function onBusca() {
      renderBusca(this.value);
    });
    $('#miipCentralBuscaResultados').off('click.miip').on('click.miip', '.miip-central-busca-item', function onSelect() {
      const produtoId = Number($(this).data('produto-id'));
      const produto = produtos.find((p) => Number(p.id) === produtoId);
      const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
      modal.hide();
      if (produto && pendencia) {
        aplicarConfirmacao(pendencia, produtoId, { id: produtoId, nome: produto.nome });
      }
    });

    renderBusca('');
    modal.show();
    setTimeout(() => $('#miipCentralBuscaInput').trigger('focus'), 200);
  }

  function cadastrarNovo() {
    const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
    const item = estado.sessao.itens[pendencia?.indice] || pendencia?.produtoXML;
    if (!item) return;

    if (typeof estado.opcoes.abrirCadastroProduto === 'function') {
      const sessao = estado.sessao;
      estado.opcoes.abrirCadastroProduto(item, (produto) => {
        if (produto?.id) {
          if (!estado || estado.sessao !== sessao) return;
          const produtos = estado.opcoes.produtos;
          if (!produtos.some((p) => String(p.id) === String(produto.id))) produtos.push(produto);

          // O operador acabou de cadastrar este produto para o item: o cadastro já é a decisão de vínculo.
          if (!pendenciaAberta(sessao, pendencia)) return;
          aplicarProdutoRecemCadastrado(pendencia, produto);
          aplicarConfirmacao(pendencia, produto.id, pendencia.produtoEncontrado);
          notificar('Produto cadastrado e vinculado ao item.', 'success');
        }
      });
      return;
    }

    abrirBuscaProduto();
    notificar('Cadastre o produto em Produtos e selecione-o na busca (F2).', 'info');
  }

  function concluirRevisao() {
    const { sessao, opcoes } = estado;
    const resultado = {
      itens: sessao.itens,
      estatisticas: {
        identificadosAutomaticamente: sessao.resumo.identificadosAutomaticamente,
        aprendeu: sessao.aprendizados,
        precisao: calcularPrecisao(sessao.resumo, sessao.confirmadosManualmente),
        confirmadosManualmente: sessao.confirmadosManualmente
      }
    };

    fecharModal();
    estado = null;
    if (typeof opcoes.onConcluir === 'function') opcoes.onConcluir(resultado);
  }

  function cancelarRevisao() {
    const cb = estado?.opcoes?.onCancelar;
    fecharModal();
    estado = null;
    if (typeof cb === 'function') cb();
  }

  function onKeydown(event) {
    if (!estado || !document.getElementById('miipCentralRevisaoModal')?.classList.contains('show')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelarRevisao();
      return;
    }

    if (estado.sessao.fase === 'final') return;

    if (event.key === 'Enter' && !$(event.target).is('input, textarea, select')) {
      event.preventDefault();
      confirmarAtual();
      return;
    }

    if (event.key === 'F2') {
      event.preventDefault();
      abrirBuscaProduto();
      return;
    }

    if (event.key === 'F3') {
      event.preventDefault();
      cadastrarNovo();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      proximaAberta(estado.sessao, event.shiftKey ? -1 : 1);
      renderTelaRevisao();
    }
  }

  function bindEventos() {
    $(document).off('.miipCentral');
    $(document).on('keydown.miipCentral', onKeydown);

    $('#miipCentralBtnConfirmar').on('click', confirmarAtual);
    $('#miipCentralBtnEscolher').on('click', abrirBuscaProduto);
    $('#miipCentralBtnCadastrar').on('click', cadastrarNovo);
    $('#miipCentralBtnIgnorar').on('click', ignorarAtual);
    $('#miipCentralBtnCancelar').on('click', cancelarRevisao);

    $('#miipCentralLista').on('click', '.miip-central-lista-item', function onListaClick() {
      estado.sessao.indiceAtual = Number($(this).data('lista-idx'));
      renderTelaRevisao();
    });

    $(document).on('click.miipCentral', '#miipCentralBtnConcluir', concluirRevisao);
  }

  function iniciar(opcoes) {
    if (!opcoes?.dadosImportacao?.miip_importacao?.usarMiipImportacaoXML) {
      if (typeof opcoes.onConcluir === 'function') {
        opcoes.onConcluir({ itens: opcoes.dadosImportacao?.itens || [], estatisticas: {} });
      }
      return;
    }

    estado = {
      opcoes: {
        apiUrl: opcoes.apiUrl || (typeof API_URL !== 'undefined' ? API_URL : '/api'),
        produtos: opcoes.produtos || [],
        obterUsuario: opcoes.obterUsuario || (() => null),
        abrirCadastroProduto: opcoes.abrirCadastroProduto || null,
        onConcluir: opcoes.onConcluir,
        onCancelar: opcoes.onCancelar
      },
      sessao: montarSessao(opcoes.dadosImportacao),
      modal: null
    };

    abrirModal();

    estado.sessao.pendencias.forEach((pendencia) => {
      if (pendencia.produtoEncontrado) return;
      const item = estado.sessao.itens[pendencia.indice] || pendencia.produtoXML;
      sugerirProdutoCadastrado(pendencia, estado.opcoes.produtos, item);
    });

    if (estado.sessao.pendencias.length === 0) {
      renderSemPendencias();
      return;
    }

    renderTelaRevisao();
  }

  global.MiipCentralRevisao = {
    iniciar,
    _test: {
      montarSessao,
      ordenarPendencias,
      extrairPendencias,
      calcularPrecisao,
      atualizarCandidatoPendencia,
      aplicarProdutoRecemCadastrado,
      sugerirProdutoCadastrado,
      normalizarNome
    }
  };
})(typeof window !== 'undefined' ? window : global);
