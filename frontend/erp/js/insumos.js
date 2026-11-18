/**
 * Fábrica → Insumos.
 * Usa o cadastro oficial de produtos com natureza_cadastro = INSUMO.
 * Não cria estoque, produção nem ficha técnica.
 * O filtro segue a mesma regra de filtrarInsumosCatalogo no GrupoInsumoService.
 */

function insEsc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function insApi(method, caminho, dados) {
  return $.ajax({
    url: API_URL + caminho,
    method: method,
    contentType: 'application/json',
    data: dados ? JSON.stringify(dados) : undefined,
    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
  });
}

function insErro(err, reserva) {
  const corpo = err && err.responseJSON;
  return (corpo && (corpo.error || corpo.message)) || reserva;
}

function insMoeda(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function insAtivo(produto) {
  return Number(produto && produto.ativo != null ? produto.ativo : 1) !== 0;
}

function insEhInsumo(produto) {
  return String(produto && produto.natureza_cadastro || '').trim().toUpperCase() === 'INSUMO';
}

function insGrupoId(produto) {
  if (!produto || produto.grupo_insumo_id == null || produto.grupo_insumo_id === '') return null;
  const id = Number(produto.grupo_insumo_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function loadInsumos() {
  $('#ins-modal, #ins-modal-grupos').remove();
  $('#page-content').html(`
    <div class="container mt-4 ft-pagina">
      <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
        <div>
          <h2 class="mb-1">Insumos</h2>
          <p class="text-muted mb-0">Materiais utilizados no processo produtivo.</p>
        </div>
        <button type="button" class="btn btn-success" id="ins-novo">+ Novo insumo</button>
      </div>
      <div class="mb-3">
        <input class="form-control" id="ins-busca" placeholder="Buscar insumo por nome, código ou grupo..." autocomplete="off">
      </div>
      <div class="d-flex gap-3 align-items-center flex-wrap mb-3">
        <select class="form-select" id="ins-filtro-grupo" style="max-width: 220px;">
          <option value="">Grupo</option>
        </select>
        <button type="button" class="btn btn-outline-secondary" id="ins-gerenciar-grupos"><i class="fas fa-cog" aria-hidden="true"></i> Gerenciar grupos</button>
        <div class="form-check mb-0">
          <input class="form-check-input" type="checkbox" id="ins-inativos">
          <label class="form-check-label" for="ins-inativos">Mostrar inativos</label>
        </div>
      </div>
      <div id="ins-lista"></div>
    </div>
  `);

  const pagina = document.querySelector('.ft-pagina');
  pagina.addEventListener('click', (evento) => {
    const alvo = evento.target.closest ? evento.target.closest('button, a') || evento.target : evento.target;
    if (alvo.id === 'ins-novo') {
      insAbrirEditor(null);
      return;
    }
    if (alvo.id === 'ins-gerenciar-grupos') {
      insAbrirGrupos();
      return;
    }
    const abrir = alvo.closest && alvo.closest('[data-ins-abrir]');
    if (abrir) {
      insApi('GET', '/produtos/' + abrir.getAttribute('data-ins-abrir'))
        .done((produto) => insAbrirEditor(produto))
        .fail((err) => showNotification(insErro(err, 'Não foi possível abrir o insumo.'), 'error'));
    }
  });
  pagina.addEventListener('input', (evento) => {
    if (evento.target.id === 'ins-busca') insRenderLista();
  });
  pagina.addEventListener('change', (evento) => {
    if (evento.target.id === 'ins-inativos' || evento.target.id === 'ins-filtro-grupo') insRenderLista();
  });

  insCarregar();
}
window.loadInsumos = loadInsumos;

function insCarregar() {
  const lista = document.getElementById('ins-lista');
  if (lista) lista.innerHTML = '<p class="text-muted">Carregando...</p>';
  $.when(
    insApi('GET', '/produtos?modo_fiscal=0'),
    insApi('GET', '/fabrica-loja/grupos-insumos')
  ).done((produtosRes, gruposRes) => {
      window._insumosCatalogo = Array.isArray(produtosRes[0]) ? produtosRes[0] : [];
      const grupos = gruposRes[0] && gruposRes[0].grupos;
      window._insumosGrupos = Array.isArray(grupos) ? grupos : [];
      insPreencherFiltroGrupos();
      insRenderLista();
      if (document.getElementById('ins-modal-grupos') && document.getElementById('ins-modal-grupos').classList.contains('show')) {
        insRenderGrupos();
      }
      insAtualizarSelectGrupo();
    })
    .fail(() => {
      if (lista) lista.innerHTML = '<div class="alert alert-danger">Erro ao carregar insumos.</div>';
    });
}

function insFiltrados() {
  const termo = String((document.getElementById('ins-busca') || {}).value || '').trim().toLowerCase();
  const mostrarInativos = !!(document.getElementById('ins-inativos') || {}).checked;
  const grupoFiltro = String((document.getElementById('ins-filtro-grupo') || {}).value || '');
  return (window._insumosCatalogo || []).filter((produto) => {
    if (!insEhInsumo(produto)) return false;
    if (!mostrarInativos && !insAtivo(produto)) return false;
    if (grupoFiltro === 'sem') {
      if (insGrupoId(produto) != null) return false;
    } else if (grupoFiltro && String(insGrupoId(produto) || '') !== grupoFiltro) {
      return false;
    }
    if (!termo) return true;
    const nome = String(produto.nome || '').toLowerCase();
    const codigo = String(produto.codigo || '').toLowerCase();
    const grupo = insNomeGrupo(produto.grupo_insumo_id).toLowerCase();
    return nome.includes(termo) || codigo.includes(termo) || grupo.includes(termo);
  });
}

function insEstoqueTexto(produto) {
  const quantidade = Number(produto && produto.estoque_atual);
  const texto = Number.isFinite(quantidade) ? quantidade.toLocaleString('pt-BR') : '0';
  return `${texto} ${produto && produto.unidade ? produto.unidade : ''}`.trim();
}

function insFormatarQuantidade(valor, unidade) {
  const quantidade = Number(valor || 0);
  const texto = Number.isFinite(quantidade)
    ? quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
    : '0';
  return `${texto} ${unidade || ''}`.trim();
}

function insCarregarEstoque(produtoId) {
  const painel = document.getElementById('ins-estoque');
  if (!painel) return;
  const produtoIdTexto = String(Number(produtoId));
  painel.setAttribute('data-produto-id', produtoIdTexto);
  const erro = document.getElementById('ins-estoque-erro');
  if (erro) {
    erro.textContent = '';
    erro.classList.add('d-none');
  }
  ['ins-estoque-fabrica-fiscal', 'ins-estoque-fabrica-nao-fiscal', 'ins-estoque-fabrica-total',
    'ins-estoque-loja-fiscal', 'ins-estoque-loja-nao-fiscal', 'ins-estoque-loja-total']
    .forEach((id) => {
      const campo = document.getElementById(id);
      if (campo) campo.textContent = 'Carregando...';
    });

  insApi('GET', '/fabrica-loja/insumos/' + produtoIdTexto + '/estoque')
    .done((resposta) => {
      const painelAtual = document.getElementById('ins-estoque');
      if (!painelAtual || painelAtual.getAttribute('data-produto-id') !== produtoIdTexto) return;
      const unidade = resposta.unidade || '';
      ['fabrica', 'loja'].forEach((local) => {
        const saldo = resposta[local] || {};
        const prefixo = local === 'fabrica' ? 'ins-estoque-fabrica' : 'ins-estoque-loja';
        document.getElementById(prefixo + '-fiscal').textContent = insFormatarQuantidade(saldo.saldo_fiscal, unidade);
        document.getElementById(prefixo + '-nao-fiscal').textContent = insFormatarQuantidade(saldo.saldo_nao_fiscal, unidade);
        document.getElementById(prefixo + '-total').textContent = insFormatarQuantidade(saldo.total, unidade);
      });
    })
    .fail((err) => {
      const painelAtual = document.getElementById('ins-estoque');
      if (!painelAtual || painelAtual.getAttribute('data-produto-id') !== produtoIdTexto) return;
      const alerta = document.getElementById('ins-estoque-erro');
      if (!alerta) return;
      alerta.textContent = insErro(err, 'Não foi possível carregar os saldos locais.');
      alerta.classList.remove('d-none');
    });
}

function insRenderLista() {
  const lista = document.getElementById('ins-lista');
  if (!lista) return;
  const itens = insFiltrados();
  if (!itens.length) {
    lista.innerHTML = '<div class="ins-tabela-card"><p class="text-muted mb-0 p-3">Nenhum insumo encontrado.</p></div>';
    return;
  }
  lista.innerHTML = `
    <div class="ins-tabela-card table-responsive">
      <table class="table table-sm align-middle ins-tabela mb-0">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Código</th>
            <th>Unidade</th>
            <th>Grupo</th>
            <th>Último custo</th>
            <th>Estoque total</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${itens.map((produto) => `
            <tr>
              <td>${insEsc(produto.nome || 'Sem nome')}</td>
              <td>${insEsc(produto.codigo || '—')}</td>
              <td>${insEsc(produto.unidade || '—')}</td>
              <td>${insEsc(insNomeGrupo(produto.grupo_insumo_id) || 'Sem grupo')}</td>
              <td>${insEsc(insMoeda(produto.preco_compra))}</td>
              <td>${insEsc(insEstoqueTexto(produto))}</td>
              <td>${insAtivo(produto) ? 'Ativo' : 'Inativo'}</td>
              <td class="text-end">
                <button type="button" class="btn btn-sm btn-outline-primary" data-ins-abrir="${Number(produto.id)}">Editar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function insProximoCodigo() {
  let max = 0;
  (window._insumosCatalogo || []).forEach((produto) => {
    const numero = parseInt(String(produto && produto.codigo || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(numero) && numero > max) max = numero;
  });
  return String(max + 1).padStart(4, '0');
}

function insNomeGrupo(id) {
  const grupo = (window._insumosGrupos || []).find((item) => String(item.id) === String(id || ''));
  return grupo ? grupo.nome : '';
}

function insOpcoesGrupo(selecionado) {
  const opcoes = ['<option value="">Sem grupo</option>'].concat((window._insumosGrupos || []).map((grupo) => {
    const marcada = String(grupo.id) === String(selecionado || '') ? ' selected' : '';
    return `<option value="${Number(grupo.id)}"${marcada}>${insEsc(grupo.nome || '')}</option>`;
  }));
  return opcoes.join('');
}

function insPreencherFiltroGrupos() {
  const select = document.getElementById('ins-filtro-grupo');
  if (!select) return;
  const atual = select.value;
  select.innerHTML = '<option value="">Grupo</option><option value="sem">Sem grupo</option>' + (window._insumosGrupos || []).map((grupo) => (
    `<option value="${Number(grupo.id)}">${insEsc(grupo.nome || '')}</option>`
  )).join('');
  if (atual && select.querySelector(`option[value="${atual}"]`)) select.value = atual;
}

function insAtualizarSelectGrupo() {
  const select = document.getElementById('ins-grupo');
  if (!select) return;
  const atual = select.value;
  select.innerHTML = insOpcoesGrupo(atual);
}

function insModal(id) {
  const el = document.getElementById(id);
  if (!el || !window.bootstrap || !bootstrap.Modal) return null;
  return bootstrap.Modal.getOrCreateInstance(el);
}

function insFecharModal(id) {
  const modal = insModal(id);
  if (modal) modal.hide();
}

function insAbrirGrupos() {
  let painel = document.getElementById('ins-modal-grupos');
  if (!painel) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade ins-modal" id="ins-modal-grupos" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Gerenciar grupos</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body" id="ins-grupos-corpo"></div>
          </div>
        </div>
      </div>
    `);
    painel = document.getElementById('ins-modal-grupos');
    painel.addEventListener('click', (evento) => {
      const alvo = evento.target;
      if (alvo.id === 'ins-grupo-novo') {
        insFormGrupo(null);
        return;
      }
      if (alvo.id === 'ins-grupo-cancelar') {
        const form = document.getElementById('ins-grupo-form');
        if (form) form.hidden = true;
        return;
      }
      const editarGrupo = alvo.closest('[data-ins-grupo-editar]');
      if (editarGrupo) {
        insFormGrupo({
          id: editarGrupo.getAttribute('data-ins-grupo-editar'),
          nome: editarGrupo.getAttribute('data-ins-grupo-nome')
        });
        return;
      }
      const excluirGrupo = alvo.closest('[data-ins-grupo-excluir]');
      if (excluirGrupo) insExcluirGrupo(excluirGrupo.getAttribute('data-ins-grupo-excluir'));
    });
    painel.addEventListener('submit', (evento) => {
      if (!evento.target || evento.target.id !== 'ins-grupo-form') return;
      evento.preventDefault();
      insSalvarGrupo();
    });
  }
  insRenderGrupos();
  const modal = insModal('ins-modal-grupos');
  if (modal) modal.show();
}

function insRenderGrupos() {
  const corpo = document.getElementById('ins-grupos-corpo');
  if (!corpo) return;
  const formAberto = document.getElementById('ins-grupo-form');
  const idAberto = formAberto && !formAberto.hidden ? document.getElementById('ins-grupo-id').value : '';
  const nomeAberto = formAberto && !formAberto.hidden ? document.getElementById('ins-grupo-nome').value : '';
  const linhas = (window._insumosGrupos || []).map((grupo) => `
    <div class="ins-grupo-linha">
      <div>
        <strong>${insEsc(grupo.nome)}</strong>
        <div class="small text-muted">${Number(grupo.quantidade || 0)} insumo(s)</div>
      </div>
      <span>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-ins-grupo-editar="${Number(grupo.id)}" data-ins-grupo-nome="${insEsc(grupo.nome)}">Editar</button>
        <button type="button" class="btn btn-sm btn-outline-danger" data-ins-grupo-excluir="${Number(grupo.id)}">Excluir</button>
      </span>
    </div>
  `).join('') || '<p class="text-muted mb-0">Nenhum grupo cadastrado.</p>';
  corpo.innerHTML = `
    <p class="small text-muted">O grupo só classifica o insumo. Não muda natureza, estoque, custo nem dados fiscais.</p>
    <button type="button" class="btn btn-success btn-sm mb-3" id="ins-grupo-novo">+ Novo grupo</button>
    <form id="ins-grupo-form" class="ins-grade mb-3" hidden>
      <input type="hidden" id="ins-grupo-id" value="">
      <div>
        <label class="form-label" for="ins-grupo-nome">Nome</label>
        <input class="form-control" id="ins-grupo-nome" required>
      </div>
      <div class="d-flex gap-2 align-items-end">
        <button type="button" class="btn btn-secondary" id="ins-grupo-cancelar">Cancelar</button>
        <button type="submit" class="btn btn-success">Salvar</button>
      </div>
    </form>
    <div>${linhas}</div>
  `;
  if (idAberto || nomeAberto) {
    insFormGrupo({ id: idAberto, nome: nomeAberto });
  }
}

function insFormGrupo(grupo) {
  const form = document.getElementById('ins-grupo-form');
  if (!form) return;
  form.hidden = false;
  document.getElementById('ins-grupo-id').value = grupo && grupo.id ? grupo.id : '';
  document.getElementById('ins-grupo-nome').value = grupo && grupo.nome ? grupo.nome : '';
  document.getElementById('ins-grupo-nome').focus();
}

function insSalvarGrupo() {
  const id = document.getElementById('ins-grupo-id').value;
  const nome = document.getElementById('ins-grupo-nome').value.trim();
  if (!nome) {
    showNotification('Informe o nome do grupo.', 'warning');
    return;
  }
  const pedido = id
    ? insApi('PUT', '/fabrica-loja/grupos-insumos/' + id, { nome: nome })
    : insApi('POST', '/fabrica-loja/grupos-insumos', { nome: nome });
  pedido.done(() => {
    showNotification('Grupo salvo.', 'success');
    insCarregar();
  }).fail((err) => showNotification(insErro(err, 'Não foi possível salvar o grupo.'), 'error'));
}

function insExcluirGrupo(id) {
  insApi('DELETE', '/fabrica-loja/grupos-insumos/' + id)
    .done(() => {
      showNotification('Grupo excluído.', 'success');
      insCarregar();
    })
    .fail((err) => showNotification(insErro(err, 'Não foi possível excluir o grupo.'), 'error'));
}

function insAbrirEditor(produto, aoFechar) {
  const atual = produto || {};
  const editando = !!atual.id;
  let produtoSalvo = null;
  const custoMedio = atual.custo_medio != null && atual.custo_medio !== '' ? insMoeda(atual.custo_medio) : '';
  const ultima = atual.ultima_compra || atual.data_ultima_compra || '';
  $('#ins-modal').remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade ins-modal" id="ins-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <form id="ins-form">
            <div class="modal-header">
              <div>
                <h5 class="modal-title mb-1">${editando ? 'Editar insumo' : 'Novo insumo'}</h5>
                <p class="text-muted small mb-0">Cadastre um material utilizado no processo produtivo.</p>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="ins-id" value="${editando ? Number(atual.id) : ''}">
              <div class="produto-ficha-secao">Informações básicas</div>
              <div class="ins-grade">
                <div>
                  <label class="form-label" for="ins-nome">Nome *</label>
                  <input class="form-control" id="ins-nome" required value="${insEsc(atual.nome || '')}">
                </div>
                <div>
                  <label class="form-label" for="ins-codigo">Código *</label>
                  <input class="form-control" id="ins-codigo" required value="${insEsc(editando ? (atual.codigo || '') : insProximoCodigo())}">
                </div>
                <div>
                  <label class="form-label" for="ins-codigo-barras">Código de barras</label>
                  <input class="form-control" id="ins-codigo-barras" type="text" inputmode="numeric" maxlength="13" autocomplete="off" placeholder="EAN-13 (opcional)" value="${insEsc(atual.codigo_barras || '')}">
                </div>
                <div>
                  <label class="form-label" for="ins-unidade">Unidade *</label>
                  <input class="form-control" id="ins-unidade" required value="${insEsc(atual.unidade || '')}" placeholder="UN, KG, L">
                </div>
                <div>
                  <label class="form-label" for="ins-grupo">Grupo</label>
                  <select class="form-select" id="ins-grupo">${insOpcoesGrupo(insGrupoId(atual))}</select>
                </div>
              </div>
              <div class="mt-3">
                <label class="form-label" for="ins-obs">Observação</label>
                <textarea class="form-control" id="ins-obs" rows="2">${insEsc(atual.observacoes || '')}</textarea>
              </div>
              ${editando ? `<p class="small text-muted mt-3 mb-0">Situação: ${insAtivo(atual) ? 'Ativo' : 'Inativo'}</p>` : ''}
              <div class="produto-ficha-secao mt-3">Custos</div>
              <div class="ins-grade">
                <div>
                  <label class="form-label" for="ins-custo">Último custo</label>
                  <input class="form-control" id="ins-custo" type="number" min="0" step="0.01" value="${editando ? Number(atual.preco_compra || 0) : 0}">
                </div>
                <div>
                  <label class="form-label" for="ins-fornecedor">Fornecedor preferencial</label>
                  <input class="form-control" id="ins-fornecedor" value="${insEsc(atual.fornecedor || '')}">
                </div>
                ${custoMedio ? `<div><label class="form-label">Custo médio</label><div class="form-control-plaintext">${insEsc(custoMedio)}</div></div>` : ''}
                ${ultima ? `<div><label class="form-label">Última compra</label><div class="form-control-plaintext">${insEsc(String(ultima))}</div></div>` : ''}
              </div>
              <div class="produto-ficha-secao mt-3">Estoque</div>
              <div id="ins-estoque" class="row g-3">
                <div id="ins-estoque-erro" class="col-12 alert alert-danger d-none mb-0" role="alert"></div>
                <div class="col-md-6">
                  <div class="card h-100">
                    <div class="card-body">
                      <h6 class="card-title">FÁBRICA</h6>
                      <div>Fiscal: <span id="ins-estoque-fabrica-fiscal">0</span></div>
                      <div>Não fiscal: <span id="ins-estoque-fabrica-nao-fiscal">0</span></div>
                      <div>Total: <strong id="ins-estoque-fabrica-total">0</strong></div>
                    </div>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="card h-100">
                    <div class="card-body">
                      <h6 class="card-title">LOJA</h6>
                      <div>Fiscal: <span id="ins-estoque-loja-fiscal">0</span></div>
                      <div>Não fiscal: <span id="ins-estoque-loja-nao-fiscal">0</span></div>
                      <div>Total: <strong id="ins-estoque-loja-total">0</strong></div>
                    </div>
                  </div>
                </div>
              </div>
              ${editando ? `<button type="button" class="btn btn-outline-primary btn-sm mt-3" data-ins-ajustar="${Number(atual.id)}">Ajustar estoque</button>` : ''}
            </div>
            <div class="modal-footer justify-content-between">
              <button type="button" class="btn btn-secondary" id="ins-cancelar" data-bs-dismiss="modal">Cancelar</button>
              <div class="d-flex gap-2">
                ${editando ? `<button type="button" class="btn btn-outline-dark" id="ins-status" data-ins-status="${Number(atual.id)}" data-ins-ativo="${insAtivo(atual) ? '0' : '1'}">${insAtivo(atual) ? 'Desabilitar' : 'Reabilitar'}</button>` : ''}
                <button type="submit" class="btn btn-success" id="ins-salvar">Salvar insumo</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  `);
  const modalEl = document.getElementById('ins-modal');
  if (typeof aoFechar === 'function') {
    modalEl.addEventListener('hidden.bs.modal', () => aoFechar(produtoSalvo));
  }
  modalEl.addEventListener('submit', (evento) => {
    evento.preventDefault();
    insSalvar((produto) => {
      produtoSalvo = produto;
    });
  });
  modalEl.addEventListener('click', (evento) => {
    const status = evento.target.closest && evento.target.closest('[data-ins-status]');
    if (status) {
      insAlterarStatus(status.getAttribute('data-ins-status'), status.getAttribute('data-ins-ativo') === '1');
      return;
    }
    const ajuste = evento.target.closest && evento.target.closest('[data-ins-ajustar]');
    if (ajuste) {
      const produtoId = Number(ajuste.getAttribute('data-ins-ajustar'));
      if (typeof window.abrirModalAjustarEstoque !== 'function') {
        showNotification('O formulário de ajuste de estoque não está disponível.', 'error');
        return;
      }
      window.abrirModalAjustarEstoque(produtoId, {
        onSaved: () => insCarregarEstoque(produtoId)
      });
    }
  });
  const modal = insModal('ins-modal');
  if (modal) modal.show();
  if (editando) {
    insCarregarEstoque(atual.id);
  } else {
    ['fabrica', 'loja'].forEach((local) => {
      const prefixo = local === 'fabrica' ? 'ins-estoque-fabrica' : 'ins-estoque-loja';
      document.getElementById(prefixo + '-fiscal').textContent = insFormatarQuantidade(0, atual.unidade || '');
      document.getElementById(prefixo + '-nao-fiscal').textContent = insFormatarQuantidade(0, atual.unidade || '');
      document.getElementById(prefixo + '-total').textContent = insFormatarQuantidade(0, atual.unidade || '');
    });
  }
  const nome = document.getElementById('ins-nome');
  if (nome) nome.focus();
}

// Mesmo critério do backend (EAN13Service): 13 dígitos com dígito verificador válido.
function insEan13Valido(valor) {
  const codigo = String(valor == null ? '' : valor).replace(/\s+/g, '');
  if (!/^\d{13}$/.test(codigo)) return false;
  let soma = 0;
  for (let i = 0; i < 12; i += 1) soma += Number(codigo[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10 === Number(codigo[12]);
}

window.abrirCadastroInsumoMiip = function (item, aoFechar) {
  const gtin = String(item && (item.codigo_barras || item.codigoBarras) || '').trim();
  insAbrirEditor({
    nome: item && item.produto_nome || '',
    unidade: item && item.unidade || '',
    codigo_barras: insEan13Valido(gtin) ? gtin : ''
  }, aoFechar);
};

function insSalvar(aoSalvar) {
  const id = document.getElementById('ins-id').value;
  const nome = document.getElementById('ins-nome').value.trim();
  const codigo = document.getElementById('ins-codigo').value.trim();
  const unidade = document.getElementById('ins-unidade').value.trim();
  if (!nome || !codigo || !unidade) {
    showNotification('Informe o nome, o código e a unidade do insumo.', 'warning');
    return;
  }
  const grupo = document.getElementById('ins-grupo').value;
  const grupoId = grupo ? Number(grupo) : null;
  const dados = {
    nome: nome,
    codigo: codigo,
    unidade: unidade,
    codigo_barras: document.getElementById('ins-codigo-barras').value.replace(/\s+/g, ''),
    grupo_insumo_id: grupoId,
    preco_compra: Number(document.getElementById('ins-custo').value) || 0,
    fornecedor: document.getElementById('ins-fornecedor').value.trim(),
    observacoes: document.getElementById('ins-obs').value || '',
    natureza_cadastro: 'INSUMO'
  };
  const botao = document.getElementById('ins-salvar');
  botao.disabled = true;
  const pedido = id
    ? insApi('PUT', '/produtos/' + id, dados)
    : insApi('POST', '/produtos', Object.assign({ preco_venda: 0, estoque_minimo: 0 }, dados));
  pedido.done((produto) => {
    if (typeof aoSalvar === 'function') aoSalvar(produto);
    const gravado = insGrupoId(produto);
    if (gravado !== grupoId) {
      botao.disabled = false;
      showNotification('O insumo foi salvo, mas o grupo não ficou gravado.', 'error');
      insCarregar();
      return;
    }
    insFecharModal('ins-modal');
    showNotification('Insumo salvo.', 'success');
    insCarregar();
  }).fail((err) => {
    botao.disabled = false;
    showNotification(insErro(err, 'Não foi possível salvar o insumo.'), 'error');
  });
}

function insAlterarStatus(id, habilitar) {
  const mensagem = habilitar
    ? 'Reabilitar este insumo? Ele voltará a aparecer nas buscas.'
    : 'Desabilitar este insumo? Ele deixa de aparecer para novos vínculos, mas fichas antigas continuam com a referência.';
  if (!confirm(mensagem)) return;
  insApi('POST', '/produtos/' + id + '/' + (habilitar ? 'ativar' : 'desativar'))
    .done(() => {
      showNotification(habilitar ? 'Insumo reabilitado.' : 'Insumo desabilitado.', 'success');
      insFecharModal('ins-modal');
      insCarregar();
    })
    .fail((err) => showNotification(insErro(err, 'Não foi possível alterar o status.'), 'error'));
}
