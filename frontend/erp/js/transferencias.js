/**
 * Transferência de estoque da Fábrica para a Loja.
 */

function trfComposicao(item) {
  if (!item || item.quantidade_fiscal == null || item.quantidade_nao_fiscal == null) return '';
  return `<div class="small">Fiscal: ${trfEsc(item.quantidade_fiscal)} ${trfEsc(item.unidade)} · Não fiscal: ${trfEsc(item.quantidade_nao_fiscal)} ${trfEsc(item.unidade)}</div>`;
}

function trfEsc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trfApi(method, caminho, dados) {
  return $.ajax({
    url: API_URL + caminho,
    method: method,
    contentType: 'application/json',
    data: dados ? JSON.stringify(dados) : undefined,
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  });
}

function trfErro(err, reserva) {
  const corpo = err && err.responseJSON;
  const faltas = (corpo && corpo.detalhes) || [];
  if (!faltas.length) return (corpo && corpo.error) || reserva;
  const linhas = faltas.map((item) => `${item.produto}: disponível ${item.disponivel} ${item.unidade}, solicitado ${item.solicitado} ${item.unidade}, faltante ${item.faltante} ${item.unidade}`);
  return `${corpo.error} ${linhas.join(' ')}`;
}

function trfData(valor) {
  const texto = String(valor || '');
  const data = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!data) return '';
  const hora = texto.match(/\d{2}:\d{2}/);
  return `${data[3]}/${data[2]}/${data[1]}${hora ? ' ' + hora[0] : ''}`;
}

function loadTransferencias() {
  $('#page-content').html(`
    <div class="container mt-4 ft-pagina">
      <div id="trf-lista-painel">
        <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
          <div>
            <h2 class="mb-1">Transferências</h2>
            <p class="ft-aviso mb-0">Move o estoque da fábrica para a loja. O produto continua sendo o mesmo.</p>
          </div>
          <button type="button" class="btn btn-success" id="trf-nova">Nova transferência</button>
        </div>
        <div class="table-responsive">
          <table class="table table-sm align-middle">
            <thead>
              <tr>
                <th>Transferência</th><th>Origem</th><th>Destino</th><th>Itens</th>
                <th>Quantidade</th><th>Data</th><th>Usuário</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody id="trf-tbody"></tbody>
          </table>
        </div>
      </div>
      <div id="trf-editor" hidden></div>
    </div>`);
  document.getElementById('trf-nova').addEventListener('click', () => trfAbrirFormulario(null));
  document.getElementById('page-content').addEventListener('click', trfClique);
  trfCarregarLista();
  const abrirInicial = window._trfAbrirId;
  const editarInicial = window._trfEditar;
  const novaInicial = window._trfNova;
  window._trfAbrirId = null;
  window._trfEditar = null;
  window._trfNova = null;
  const origem = window._trfOrigemProducao;
  if (origem && Array.isArray(origem.itens) && origem.itens.length) {
    window._trfOrigemProducao = null;
    trfAbrirFormulario({
      observacao: origem.ordem ? `Produção ${origem.ordem}` : '',
      itens: origem.itens
    });
  } else if (abrirInicial) {
    trfAbrir(abrirInicial, !!editarInicial);
  } else if (novaInicial) {
    trfAbrirFormulario(null);
  }
}

function trfCarregarLista() {
  trfApi('GET', '/fabrica-loja/transferencias').done((resposta) => {
    const corpo = document.getElementById('trf-tbody');
    if (!corpo) return;
    const lista = (resposta && resposta.transferencias) || [];
    if (!lista.length) {
      corpo.innerHTML = '<tr><td colspan="9" class="text-muted">Nenhuma transferência encontrada.</td></tr>';
      return;
    }
    corpo.innerHTML = lista.map((item) => {
      const editar = item.status === 'RASCUNHO' ? `<button type="button" class="btn btn-sm btn-outline-primary" data-trf-editar="${item.id}">Editar</button>` : '';
      const confirmar = item.status === 'RASCUNHO' ? `<button type="button" class="btn btn-sm btn-success" data-trf-confirmar="${item.id}">Confirmar</button>` : '';
      const cancelar = item.status === 'RASCUNHO' ? `<button type="button" class="btn btn-sm btn-outline-warning" data-trf-cancelar="${item.id}">Cancelar</button>` : '';
      return `<tr>
        <td>${trfEsc(item.codigo)}</td>
        <td>${trfEsc(item.origem_local)}</td>
        <td>${trfEsc(item.destino_local)}</td>
        <td>${(item.itens || []).length}</td>
        <td>${trfEsc(item.quantidade_total)}</td>
        <td>${trfEsc(trfData(item.confirmada_em || item.created_at))}</td>
        <td>${trfEsc(item.usuario_nome || '—')}</td>
        <td>${trfEsc(item.status)}</td>
        <td class="text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-trf-ver="${item.id}">Visualizar</button>
          ${editar} ${confirmar} ${cancelar}
        </td>
      </tr>`;
    }).join('');
  }).fail((err) => showNotification(trfErro(err, 'Não foi possível carregar as transferências.'), 'error'));
}

function trfFechar() {
  document.getElementById('trf-editor').hidden = true;
  document.getElementById('trf-lista-painel').hidden = false;
  trfCarregarLista();
}

function trfHtmlItem(item) {
  const incluir = item && item.produto_id
    ? `<div class="form-check mb-2"><input class="form-check-input trf-incluir" type="checkbox" checked><label class="form-check-label">Incluir na transferência</label></div>`
    : '';
  return `<div class="trf-linha ft-linha border rounded p-2 mb-2" data-disponivel="${item && item.disponivel != null ? trfEsc(item.disponivel) : ''}">
    ${incluir}
    <div class="row g-2 align-items-end">
      <div class="col-md-5">
        <label class="form-label mb-1">Produto</label>
        <input class="form-control trf-busca" value="${trfEsc(item.produto_nome || '')}" data-produto-id="${trfEsc(item.produto_id || '')}" autocomplete="off">
        <div class="trf-sugestoes list-group position-absolute" hidden></div>
      </div>
      <div class="col-md-2">
        <label class="form-label mb-1">Quantidade</label>
        <input class="form-control trf-qtd" type="number" min="0.001" step="0.001" value="${trfEsc(item.quantidade || '')}">
      </div>
      <div class="col-md-2">
        <label class="form-label mb-1">Unidade</label>
        <input class="form-control trf-un" value="${trfEsc(item.unidade || '')}">
      </div>
      <div class="col-md-2">
        <div class="small text-muted trf-disponivel">${item.disponivel != null ? 'Disponível na fábrica: ' + trfEsc(item.disponivel) : ''}</div>
      </div>
      <div class="col-md-1">
        <button type="button" class="btn btn-outline-danger btn-sm trf-remover">Remover</button>
      </div>
    </div>
  </div>`;
}

function trfAbrirFormulario(doc) {
  const editor = document.getElementById('trf-editor');
  const itens = (doc && doc.itens) || [{}];
  editor.hidden = false;
  document.getElementById('trf-lista-painel').hidden = true;
  editor.innerHTML = `
    <form id="trf-form" class="card" data-id="${doc ? trfEsc(doc.id) : ''}">
      <div class="card-body">
        <h2 class="h4">${doc && doc.id ? trfEsc(doc.codigo) : 'Nova transferência'}</h2>
        <div class="row g-3 mb-3">
          <div class="col-md-4"><div class="text-muted small">Origem</div><strong>FÁBRICA</strong></div>
          <div class="col-md-4"><div class="text-muted small">Destino</div><strong>LOJA</strong></div>
        </div>
        <label class="form-label" for="trf-obs">Observação</label>
        <textarea class="form-control mb-3" id="trf-obs" rows="2">${trfEsc(doc ? doc.observacao : '')}</textarea>
        <div id="trf-itens">${itens.map((item) => trfHtmlItem(item)).join('')}</div>
        <button type="button" class="btn btn-outline-primary btn-sm" id="trf-add">+ Adicionar produto</button>
      </div>
      <div class="card-footer d-flex gap-2 justify-content-end">
        <button type="button" class="btn btn-outline-secondary" id="trf-voltar">Voltar</button>
        <button type="submit" class="btn btn-success">Salvar rascunho</button>
      </div>
    </form>`;
  document.getElementById('trf-voltar').addEventListener('click', trfFechar);
  document.getElementById('trf-add').addEventListener('click', () => {
    document.getElementById('trf-itens').insertAdjacentHTML('beforeend', trfHtmlItem({}));
  });
  document.getElementById('trf-form').addEventListener('submit', trfSalvar);
  document.getElementById('trf-itens').addEventListener('click', (evento) => {
    if (evento.target.classList.contains('trf-remover')) evento.target.closest('.trf-linha').remove();
  });
  document.getElementById('trf-itens').addEventListener('input', trfBuscarProduto);
}

function trfBuscarProduto(evento) {
  const campo = evento.target;
  if (!campo.classList || !campo.classList.contains('trf-busca')) return;
  const caixa = campo.parentElement.querySelector('.trf-sugestoes');
  const termo = campo.value.trim();
  if (termo.length < 2) {
    caixa.hidden = true;
    return;
  }
  trfApi('GET', '/produtos/search?q=' + encodeURIComponent(termo)).done((resposta) => {
    const itens = (resposta && resposta.items) || (Array.isArray(resposta) ? resposta : []);
    caixa.innerHTML = itens.slice(0, 8).map((item) => `
      <button type="button" class="list-group-item list-group-item-action trf-escolher"
        data-id="${trfEsc(item.id)}" data-nome="${trfEsc(item.nome)}" data-unidade="${trfEsc(item.unidade || 'UN')}">
        ${trfEsc(item.nome)}
      </button>`).join('');
    caixa.hidden = !itens.length;
  });
}

function trfEscolherProduto(botao) {
  const linha = botao.closest('.trf-linha');
  const campo = linha.querySelector('.trf-busca');
  campo.value = botao.getAttribute('data-nome');
  campo.setAttribute('data-produto-id', botao.getAttribute('data-id'));
  linha.querySelector('.trf-un').value = botao.getAttribute('data-unidade') || 'UN';
  botao.parentElement.hidden = true;
  trfApi('GET', '/fabrica-loja/transferencias/disponivel?produto_id=' + botao.getAttribute('data-id') + '&local=FABRICA').done((resposta) => {
    const saldo = resposta.saldo || {};
    linha.querySelector('.trf-disponivel').textContent = `Disponível na fábrica: ${saldo.disponivel} ${saldo.unidade || ''}`;
  });
}

function trfColetar() {
  const itens = [];
  document.querySelectorAll('#trf-itens .trf-linha').forEach((linha) => {
    delete linha.dataset.excesso;
    const incluir = linha.querySelector('.trf-incluir');
    if (incluir && !incluir.checked) return;
    const campo = linha.querySelector('.trf-busca');
    const quantidade = Number(linha.querySelector('.trf-qtd').value);
    const disponivel = Number(linha.getAttribute('data-disponivel'));
    if (Number.isFinite(disponivel) && linha.getAttribute('data-disponivel') !== '' && quantidade > disponivel + 0.000001) {
      linha.dataset.excesso = '1';
    }
    itens.push({
      produto_id: Number(campo.getAttribute('data-produto-id')),
      quantidade: Number(linha.querySelector('.trf-qtd').value),
      unidade: linha.querySelector('.trf-un').value,
      produto_nome: campo.value
    });
  });
  return {
    origem_local: 'FABRICA',
    destino_local: 'LOJA',
    observacao: document.getElementById('trf-obs').value,
    itens
  };
}

function trfSalvar(evento) {
  evento.preventDefault();
  const dados = trfColetar();
  if (document.querySelector('#trf-itens .trf-linha[data-excesso="1"]')) {
    showNotification('A quantidade não pode ser superior ao disponível na Fábrica.', 'warning');
    document.querySelectorAll('#trf-itens .trf-linha').forEach((linha) => delete linha.dataset.excesso);
    return;
  }
  const id = document.getElementById('trf-form').getAttribute('data-id');
  const pedido = id
    ? trfApi('PUT', '/fabrica-loja/transferencias/' + id, dados)
    : trfApi('POST', '/fabrica-loja/transferencias', dados);
  pedido.done(() => {
    showNotification('Rascunho salvo. Nenhum estoque foi movimentado.', 'success');
    trfFechar();
  }).fail((err) => showNotification(trfErro(err, 'Não foi possível salvar a transferência.'), 'error'));
}

function trfAbrirDetalhe(doc) {
  const editor = document.getElementById('trf-editor');
  editor.hidden = false;
  document.getElementById('trf-lista-painel').hidden = true;
  const confirmada = doc.status === 'CONFIRMADA';
  editor.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="d-flex justify-content-between mb-3">
          <h2 class="h4 mb-0">${trfEsc(doc.codigo)}</h2>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="trf-voltar">Voltar</button>
        </div>
        <div>Origem: <strong>${trfEsc(doc.origem_local)}</strong></div>
        <div>Destino: <strong>${trfEsc(doc.destino_local)}</strong></div>
        <div>Status: <strong>${trfEsc(doc.status)}</strong></div>
        <div>Data: ${trfEsc(trfData(doc.confirmada_em || doc.created_at) || '—')}</div>
        <div>Usuário: ${trfEsc(doc.usuario_nome || '—')}</div>
        <div class="ft-bloco"><h3>Itens</h3>
          ${(doc.itens || []).map((item) => `<div>${trfEsc(item.produto_nome)}: ${trfEsc(item.quantidade)} ${trfEsc(item.unidade)}${trfComposicao(item)}</div>`).join('')}
        </div>
        ${confirmada ? `<div class="ft-bloco"><h3>Movimentação</h3>
          ${(doc.itens || []).map((item) => `<div>${trfEsc(item.produto_nome)} — Fábrica: -${trfEsc(item.quantidade)} ${trfEsc(item.unidade)} · Loja: +${trfEsc(item.quantidade)} ${trfEsc(item.unidade)}${trfComposicao(item)}</div>`).join('')}
        </div>` : ''}
      </div>
      <div class="card-footer d-flex gap-2 justify-content-end">
        ${doc.status === 'RASCUNHO' ? `<button type="button" class="btn btn-outline-primary" data-trf-editar="${doc.id}">Editar</button>` : ''}
        ${doc.status === 'RASCUNHO' ? `<button type="button" class="btn btn-success" data-trf-confirmar="${doc.id}">Confirmar</button>` : ''}
        ${doc.status === 'RASCUNHO' ? `<button type="button" class="btn btn-outline-warning" data-trf-cancelar="${doc.id}">Cancelar</button>` : ''}
      </div>
    </div>`;
  document.getElementById('trf-voltar').addEventListener('click', trfFechar);
}

function trfAbrir(id, editar) {
  trfApi('GET', '/fabrica-loja/transferencias/' + id).done((resposta) => {
    if (editar && resposta.transferencia.status === 'RASCUNHO') trfAbrirFormulario(resposta.transferencia);
    else trfAbrirDetalhe(resposta.transferencia);
  }).fail((err) => showNotification(trfErro(err, 'Não foi possível abrir a transferência.'), 'error'));
}

function trfConfirmar(id) {
  trfApi('GET', '/fabrica-loja/transferencias/' + id + '/previa').done((resposta) => {
    const previa = resposta.previa || {};
    const correlation = `trf-${id}-${Date.now()}`;
    $('#modalTransferencia').remove();
    $('body').append(`
      <div class="modal fade" id="modalTransferencia" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Confirmar transferência</h5></div>
            <div class="modal-body">
              <p>Origem: <strong>FÁBRICA</strong></p>
              <p>Destino: <strong>LOJA</strong></p>
              ${(previa.previa_itens || []).map((item) => `
                <div class="border rounded p-2 mb-2">
                  <strong>${trfEsc(item.produto_nome)}</strong> ${trfEsc(item.quantidade)} ${trfEsc(item.unidade)}
                  <div>Estoque fábrica: ${trfEsc(item.disponivel_fabrica)} → ${trfEsc(item.fabrica_depois)}</div>
                  <div>Estoque loja: ${trfEsc(item.estoque_loja)} → ${trfEsc(item.loja_depois)}</div>
                </div>`).join('')}
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-success" id="trf-confirmar-ok" data-correlation="${trfEsc(correlation)}">Confirmar transferência</button>
            </div>
          </div>
        </div>
      </div>`);
    const modal = new bootstrap.Modal(document.getElementById('modalTransferencia'));
    modal.show();
    document.getElementById('trf-confirmar-ok').addEventListener('click', function confirmar() {
      this.disabled = true;
      trfApi('POST', '/fabrica-loja/transferencias/' + id + '/confirmar', {
        correlation_id: this.getAttribute('data-correlation')
      }).done(() => {
        modal.hide();
        showNotification('Transferência confirmada. O estoque saiu da fábrica e entrou na loja.', 'success');
        trfAbrir(id, false);
        trfCarregarLista();
      }).fail((err) => {
        this.disabled = false;
        showNotification(trfErro(err, 'Não foi possível confirmar a transferência.'), 'error');
      });
    });
    document.getElementById('modalTransferencia').addEventListener('hidden.bs.modal', function () {
      $('#modalTransferencia').remove();
    });
  }).fail((err) => showNotification(trfErro(err, 'Não foi possível preparar a transferência.'), 'error'));
}

function trfClique(evento) {
  const alvo = evento.target.closest('[data-trf-ver], [data-trf-editar], [data-trf-confirmar], [data-trf-cancelar], .trf-escolher');
  if (!alvo) return;
  if (alvo.classList.contains('trf-escolher')) {
    trfEscolherProduto(alvo);
    return;
  }
  const ver = alvo.getAttribute('data-trf-ver');
  if (ver) return trfAbrir(ver, false);
  const editar = alvo.getAttribute('data-trf-editar');
  if (editar) return trfAbrir(editar, true);
  const confirmar = alvo.getAttribute('data-trf-confirmar');
  if (confirmar) return trfConfirmar(confirmar);
  const cancelar = alvo.getAttribute('data-trf-cancelar');
  if (cancelar && window.confirm('Cancelar esta transferência? Isso não movimenta estoque.')) {
    trfApi('POST', '/fabrica-loja/transferencias/' + cancelar + '/cancelar').done(() => {
      showNotification('Transferência cancelada.', 'success');
      trfFechar();
    }).fail((err) => showNotification(trfErro(err, 'Não foi possível cancelar.'), 'error'));
  }
}
