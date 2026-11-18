/**
 * Fábrica → Linhas de Produtos.
 * Agrupa produtos físicos (produtos.linha_produtos_id). A linha não é produto:
 * não tem estoque, preço nem OP. Não é a Linha de Precificação.
 * O vínculo produto → linha é feito no cadastro do produto.
 */

function lpEsc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lpApi(method, caminho, dados) {
  return $.ajax({
    url: API_URL + caminho,
    method: method,
    contentType: 'application/json',
    data: dados ? JSON.stringify(dados) : undefined,
    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
  });
}

function lpErro(err, reserva) {
  const corpo = err && err.responseJSON;
  return (corpo && (corpo.error || corpo.message)) || reserva;
}

function lpModal(id) {
  const el = document.getElementById(id);
  if (!el || !window.bootstrap || !bootstrap.Modal) return null;
  return bootstrap.Modal.getOrCreateInstance(el);
}

function lpNatureza(valor) {
  const natureza = String(valor || '').trim().toUpperCase();
  if (natureza === 'PRODUZIDO') return 'Produzido';
  if (natureza === 'COMERCIAL') return 'Comercial';
  return 'Não classificado';
}

function loadLinhasProdutos() {
  $('#lp-modal, #lp-modal-produtos').remove();
  $('#page-content').html(`
    <div class="container mt-4 ft-pagina lp-pagina">
      <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
        <div>
          <h2 class="mb-1">Linhas de Produtos</h2>
          <p class="text-muted mb-0">Agrupa os produtos (ex.: os sabores de uma linha de picolé).</p>
        </div>
        <button type="button" class="btn btn-success" id="lp-nova">+ Nova linha</button>
      </div>
      <div class="d-flex gap-3 align-items-center flex-wrap mb-3">
        <input class="form-control" id="lp-busca" placeholder="Buscar linha por nome ou código..." autocomplete="off" style="max-width: 420px;">
        <div class="form-check mb-0">
          <input class="form-check-input" type="checkbox" id="lp-inativas">
          <label class="form-check-label" for="lp-inativas">Mostrar inativas</label>
        </div>
      </div>
      <div id="lp-lista"></div>
    </div>
  `);

  const pagina = document.querySelector('.lp-pagina');
  pagina.addEventListener('click', (evento) => {
    const alvo = evento.target.closest ? evento.target.closest('button') || evento.target : evento.target;
    if (alvo.id === 'lp-nova') {
      lpAbrirEditor(null);
      return;
    }
    const editar = alvo.closest && alvo.closest('[data-lp-editar]');
    if (editar) {
      const linha = (window._linhasProdutos || []).find((item) => String(item.id) === editar.getAttribute('data-lp-editar'));
      if (linha) lpAbrirEditor(linha);
      return;
    }
    const produtos = alvo.closest && alvo.closest('[data-lp-produtos]');
    if (produtos) lpAbrirProdutos(produtos.getAttribute('data-lp-produtos'));
  });
  pagina.addEventListener('input', (evento) => {
    if (evento.target.id === 'lp-busca') lpRenderLista();
  });
  pagina.addEventListener('change', (evento) => {
    if (evento.target.id === 'lp-inativas') lpRenderLista();
  });

  lpCarregar();
}
window.loadLinhasProdutos = loadLinhasProdutos;

function lpCarregar() {
  const lista = document.getElementById('lp-lista');
  if (lista) lista.innerHTML = '<p class="text-muted">Carregando...</p>';
  lpApi('GET', '/fabrica-loja/linhas-produtos?incluir_inativas=1')
    .done((resposta) => {
      window._linhasProdutosInstalada = !(resposta && resposta.instalada === false);
      window._linhasProdutos = Array.isArray(resposta && resposta.linhas) ? resposta.linhas : [];
      lpRenderLista();
    })
    .fail(() => {
      if (lista) lista.innerHTML = '<div class="alert alert-danger">Erro ao carregar as linhas de produtos.</div>';
    });
}

function lpFiltradas() {
  const termo = String((document.getElementById('lp-busca') || {}).value || '').trim().toLowerCase();
  const inativas = !!(document.getElementById('lp-inativas') || {}).checked;
  return (window._linhasProdutos || []).filter((linha) => {
    if (!inativas && Number(linha.ativo) !== 1) return false;
    if (!termo) return true;
    return String(linha.nome || '').toLowerCase().includes(termo) || String(linha.codigo || '').toLowerCase().includes(termo);
  });
}

function lpRenderLista() {
  const lista = document.getElementById('lp-lista');
  if (!lista) return;
  const botaoNova = document.getElementById('lp-nova');
  if (!window._linhasProdutosInstalada) {
    if (botaoNova) botaoNova.disabled = true;
    lista.innerHTML = '<div class="alert alert-warning">A estrutura de Linha de Produtos não está instalada neste banco.</div>';
    return;
  }
  if (botaoNova) botaoNova.disabled = false;
  const itens = lpFiltradas();
  if (!itens.length) {
    lista.innerHTML = '<div class="ins-tabela-card"><p class="text-muted mb-0 p-3">Nenhuma linha encontrada.</p></div>';
    return;
  }
  lista.innerHTML = `
    <div class="ins-tabela-card table-responsive">
      <table class="table table-sm align-middle ins-tabela mb-0">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nome</th>
            <th>Produtos</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${itens.map((linha) => `
            <tr>
              <td class="text-nowrap">${lpEsc(linha.codigo || '—')}</td>
              <td>
                <div>${lpEsc(linha.nome)}</div>
                ${linha.descricao ? `<div class="small text-muted">${lpEsc(linha.descricao)}</div>` : ''}
              </td>
              <td class="text-nowrap">${Number(linha.quantidade_produtos || 0)} <span class="small text-muted">(${Number(linha.quantidade_produtos_ativos || 0)} ativos)</span></td>
              <td>${Number(linha.ativo) === 1 ? '<span class="badge bg-success">Ativa</span>' : '<span class="badge bg-secondary">Inativa</span>'}</td>
              <td class="text-end text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-secondary" data-lp-produtos="${Number(linha.id)}">Ver produtos</button>
                <button type="button" class="btn btn-sm btn-outline-primary" data-lp-editar="${Number(linha.id)}">Editar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function lpAbrirEditor(linha) {
  const atual = linha || {};
  const editando = !!atual.id;
  const temProdutos = Number(atual.quantidade_produtos || 0) > 0;
  const ativa = Number(atual.ativo != null ? atual.ativo : 1) === 1;
  $('#lp-modal').remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade ins-modal" id="lp-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <form id="lp-form">
            <div class="modal-header">
              <div>
                <h5 class="modal-title mb-1">${editando ? 'Editar linha' : 'Nova linha'}</h5>
                <p class="text-muted small mb-0">Agrupa produtos físicos. O vínculo é feito no cadastro do produto.</p>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="lp-id" value="${editando ? Number(atual.id) : ''}">
              <div class="ins-grade">
                <div>
                  <label class="form-label" for="lp-codigo">Código</label>
                  <input class="form-control" id="lp-codigo" maxlength="30" value="${lpEsc(atual.codigo || '')}" placeholder="PIC-CREMOSO">
                </div>
                <div>
                  <label class="form-label" for="lp-nome">Nome *</label>
                  <input class="form-control" id="lp-nome" maxlength="80" required value="${lpEsc(atual.nome || '')}">
                </div>
              </div>
              <div class="mt-3">
                <label class="form-label" for="lp-descricao">Descrição</label>
                <textarea class="form-control" id="lp-descricao" rows="2">${lpEsc(atual.descricao || '')}</textarea>
              </div>
              ${editando ? `<p class="small text-muted mt-3 mb-0">Situação: ${ativa ? 'Ativa' : 'Inativa'} · ${Number(atual.quantidade_produtos || 0)} produto(s) vinculado(s)</p>` : ''}
            </div>
            <div class="modal-footer justify-content-between">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
              <div class="d-flex gap-2">
                ${editando ? `<button type="button" class="btn btn-outline-danger" id="lp-excluir" ${temProdutos ? 'disabled title="Linha com produtos vinculados não pode ser excluída. Inative a linha."' : ''}>Excluir</button>` : ''}
                ${editando ? `<button type="button" class="btn btn-outline-dark" id="lp-status" data-lp-ativar="${ativa ? '0' : '1'}">${ativa ? 'Inativar' : 'Reativar'}</button>` : ''}
                <button type="submit" class="btn btn-success" id="lp-salvar">Salvar linha</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  `);
  const modalEl = document.getElementById('lp-modal');
  modalEl.addEventListener('submit', (evento) => {
    evento.preventDefault();
    lpSalvar();
  });
  modalEl.addEventListener('click', (evento) => {
    if (evento.target.id === 'lp-status') lpAlterarStatus(atual.id, evento.target.getAttribute('data-lp-ativar') === '1');
    if (evento.target.id === 'lp-excluir') lpExcluir(atual.id);
  });
  const modal = lpModal('lp-modal');
  if (modal) modal.show();
}

function lpFecharEditor() {
  const modal = lpModal('lp-modal');
  if (modal) modal.hide();
}

function lpSalvar() {
  const id = document.getElementById('lp-id').value;
  const nome = document.getElementById('lp-nome').value.trim();
  if (!nome) {
    showNotification('Informe o nome da linha.', 'warning');
    return;
  }
  const dados = {
    codigo: document.getElementById('lp-codigo').value.trim(),
    nome: nome,
    descricao: document.getElementById('lp-descricao').value.trim()
  };
  const botao = document.getElementById('lp-salvar');
  botao.disabled = true;
  const pedido = id
    ? lpApi('PUT', '/fabrica-loja/linhas-produtos/' + id, dados)
    : lpApi('POST', '/fabrica-loja/linhas-produtos', dados);
  pedido.done(() => {
    lpFecharEditor();
    showNotification('Linha salva.', 'success');
    lpCarregar();
  }).fail((err) => {
    botao.disabled = false;
    showNotification(lpErro(err, 'Não foi possível salvar a linha.'), 'error');
  });
}

function lpAlterarStatus(id, ativar) {
  const mensagem = ativar
    ? 'Reativar esta linha? Ela volta a aparecer para novos vínculos.'
    : 'Inativar esta linha? Os produtos continuam vinculados, mas a linha deixa de aparecer para novos vínculos.';
  if (!confirm(mensagem)) return;
  lpApi('POST', '/fabrica-loja/linhas-produtos/' + id + '/' + (ativar ? 'ativar' : 'desativar'))
    .done(() => {
      lpFecharEditor();
      showNotification(ativar ? 'Linha reativada.' : 'Linha inativada.', 'success');
      lpCarregar();
    })
    .fail((err) => showNotification(lpErro(err, 'Não foi possível alterar a situação da linha.'), 'error'));
}

function lpExcluir(id) {
  if (!confirm('Excluir esta linha? Esta ação não pode ser desfeita.')) return;
  lpApi('DELETE', '/fabrica-loja/linhas-produtos/' + id)
    .done(() => {
      lpFecharEditor();
      showNotification('Linha excluída.', 'success');
      lpCarregar();
    })
    .fail((err) => showNotification(lpErro(err, 'Não foi possível excluir a linha.'), 'error'));
}

function lpAbrirProdutos(id) {
  $('#lp-modal-produtos').remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade ins-modal" id="lp-modal-produtos" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="lp-produtos-titulo">Produtos da linha</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
          </div>
          <div class="modal-body" id="lp-produtos-corpo"><p class="text-muted">Carregando...</p></div>
        </div>
      </div>
    </div>
  `);
  const modal = lpModal('lp-modal-produtos');
  if (modal) modal.show();
  lpApi('GET', '/fabrica-loja/linhas-produtos/' + id)
    .done((resposta) => {
      const linha = resposta && resposta.linha;
      const corpo = document.getElementById('lp-produtos-corpo');
      if (!linha || !corpo) return;
      document.getElementById('lp-produtos-titulo').textContent = 'Produtos da linha ' + linha.nome;
      const produtos = linha.produtos || [];
      corpo.innerHTML = `
        <p class="small text-muted">Para vincular ou remover um produto, edite o produto em Cadastros → Produtos, campo "Linha de Produtos".</p>
        ${produtos.length ? `
          <div class="ins-tabela-card table-responsive">
            <table class="table table-sm align-middle ins-tabela mb-0">
              <thead><tr><th>ID</th><th>Código</th><th>Produto</th><th>Natureza</th><th>Situação</th></tr></thead>
              <tbody>
                ${produtos.map((produto) => `
                  <tr>
                    <td>${Number(produto.id)}</td>
                    <td>${lpEsc(produto.codigo || '—')}</td>
                    <td>${lpEsc(produto.nome)}</td>
                    <td>${lpEsc(lpNatureza(produto.natureza_cadastro))}</td>
                    <td>${Number(produto.ativo) === 1 ? 'Ativo' : 'Inativo'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p class="text-muted mb-0">Nenhum produto vinculado.</p>'}
      `;
    })
    .fail((err) => {
      const corpo = document.getElementById('lp-produtos-corpo');
      if (corpo) corpo.innerHTML = `<div class="alert alert-danger">${lpEsc(lpErro(err, 'Não foi possível carregar os produtos.'))}</div>`;
    });
}
