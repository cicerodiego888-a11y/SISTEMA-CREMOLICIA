/**
 * Ordens de produção.
 * Planeja a ordem e executa a produção confirmada pela fábrica.
 */

const OP_ORIGENS = [
  { id: 'NECESSIDADE', nome: 'Necessidade de Produção' },
  { id: 'PEDIDO_LOJA', nome: 'Pedido ou demanda da loja' },
  { id: 'ABASTECIMENTO', nome: 'Abastecimento interno' },
  { id: 'PLANEJAMENTO', nome: 'Planejamento' },
  { id: 'MANUAL', nome: 'Manual' }
];

const OP_PRIORIDADES = [
  { id: 'BAIXA', nome: 'Baixa' },
  { id: 'NORMAL', nome: 'Normal' },
  { id: 'ALTA', nome: 'Alta' },
  { id: 'URGENTE', nome: 'Urgente' }
];

const OP_STATUS = ['RASCUNHO', 'PLANEJADA', 'EM_PRODUCAO', 'CONCLUIDA', 'CANCELADA'];

function opEsc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function opNomeOrigem(origem) {
  const achada = OP_ORIGENS.find((item) => item.id === origem);
  return achada ? achada.nome : (origem || '');
}

function opNomeStatus(status) {
  const nomes = {
    RASCUNHO: 'Rascunho',
    PLANEJADA: 'Planejada',
    EM_PRODUCAO: 'Em produção',
    CONCLUIDA: 'Concluída',
    CANCELADA: 'Cancelada'
  };
  return nomes[status] || status || '';
}

function opData(valor) {
  const texto = String(valor || '');
  const data = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!data) return '';
  const hora = texto.match(/\d{2}:\d{2}/);
  return `${data[3]}/${data[2]}/${data[1]}${hora ? ' ' + hora[0] : ''}`;
}

function opApi(method, caminho, dados) {
  return $.ajax({
    url: API_URL + caminho,
    method: method,
    contentType: 'application/json',
    data: dados ? JSON.stringify(dados) : undefined,
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  });
}

function opErro(err, reserva) {
  const corpo = err && err.responseJSON;
  return (corpo && corpo.error) || reserva;
}

function opCarregarFichas() {
  window.opVinculosFichas = {};
  return $.Deferred().resolve([]).promise();
}

function opCarregarVinculosProduto(produtoId) {
  if (!produtoId) return $.Deferred().resolve([]).promise();
  window.opVinculosFichas = window.opVinculosFichas || {};
  const chave = String(produtoId);
  if (Object.prototype.hasOwnProperty.call(window.opVinculosFichas, chave)) {
    return $.Deferred().resolve(window.opVinculosFichas[chave]).promise();
  }
  return opApi('GET', `/fabrica-loja/fichas/produtos/${encodeURIComponent(produtoId)}/vinculos`)
    .then((resposta) => {
      const fichas = (resposta && resposta.fichas) || [];
      window.opVinculosFichas[chave] = fichas;
      return fichas;
    });
}

function opCarregarVinculosItens(itens) {
  const ids = [...new Set((itens || []).map((item) => item.produto_id).filter(Boolean))];
  return $.when.apply($, ids.map(opCarregarVinculosProduto));
}

function opHtmlFicha(item, produtoId) {
  const atual = item || {};
  const fichas = (window.opVinculosFichas && window.opVinculosFichas[String(produtoId)]) || [];
  let escolhida = atual.ficha_padrao_vinculo_id
    ? `padrao:${atual.ficha_padrao_vinculo_id}:${atual.ficha_padrao_versao_id || ''}`
    : (atual.ficha_tecnica_id ? `tradicional:${atual.ficha_tecnica_id}` : '');
  if (!escolhida && fichas.length === 1) {
    const unica = fichas[0];
    escolhida = unica.origem === 'TRADICIONAL'
      ? `tradicional:${unica.ficha_tecnica_id}`
      : `padrao:${unica.ficha_padrao_vinculo_id}:${unica.ficha_padrao_versao_id}`;
  }
  const opcoes = ['<option value="">Selecione uma ficha (opcional)</option>'].concat(fichas.map((ficha) => {
    const tradicional = ficha.origem === 'TRADICIONAL';
    const valor = tradicional
      ? `tradicional:${ficha.ficha_tecnica_id}`
      : `padrao:${ficha.ficha_padrao_vinculo_id}:${ficha.ficha_padrao_versao_id}`;
    const marca = escolhida === valor ? ' selected' : '';
    const origem = tradicional
      ? 'Tradicional'
      : `${ficha.tipo === 'SABOR' ? 'Por sabor' : 'Padrão legado'} · versão ${opEsc(ficha.numero_versao)}`;
    return `<option value="${opEsc(valor)}"${marca}>${opEsc(ficha.codigo)} — ${opEsc(ficha.nome)} · ${origem}</option>`;
  }));
  const fichaCapturadaAtiva = fichas.some((ficha) =>
    Number(ficha.ficha_padrao_vinculo_id) === Number(atual.ficha_padrao_vinculo_id) &&
    Number(ficha.ficha_padrao_versao_id) === Number(atual.ficha_padrao_versao_id)
  );
  if (atual.ficha_padrao_vinculo_id && !fichaCapturadaAtiva) {
    const snapshot = atual.ficha_padrao_snapshot || {};
    const valor = `padrao:${atual.ficha_padrao_vinculo_id}:${atual.ficha_padrao_versao_id || ''}`;
    const categoria = snapshot.ficha_por_sabor ? 'Ficha por sabor' : 'Ficha padrão legada';
    opcoes.push(`<option value="${opEsc(valor)}" selected>${opEsc(snapshot.codigo || categoria)} — ${opEsc(snapshot.nome || 'Vínculo capturado')} · versão capturada</option>`);
    escolhida = valor;
  }
  const fichaTradicionalAtiva = fichas.some((ficha) =>
    ficha.origem === 'TRADICIONAL' &&
    Number(ficha.ficha_tecnica_id) === Number(atual.ficha_tecnica_id)
  );
  if (atual.ficha_tecnica_id && !fichaTradicionalAtiva) {
    const valor = `tradicional:${atual.ficha_tecnica_id}`;
    opcoes.push(`<option value="${opEsc(valor)}"${escolhida === valor ? ' selected' : ''}>Ficha tradicional #${opEsc(atual.ficha_tecnica_id)} (registro legado)</option>`);
  }
  return `<select class="form-select form-select-sm" data-campo="ficha_escolhida">${opcoes.join('')}</select>`;
}

function opColetarFicha(linha) {
  const select = linha.querySelector('[data-campo="ficha_escolhida"]');
  const escolha = select ? select.value : '';
  const item = { ficha_tecnica_id: '', ficha_padrao_vinculo_id: '', ficha_padrao_versao_id: '' };
  if (escolha.startsWith('tradicional:')) item.ficha_tecnica_id = escolha.slice('tradicional:'.length);
  const padrao = escolha.match(/^padrao:(\d+):(\d*)$/);
  if (padrao) {
    item.ficha_padrao_vinculo_id = padrao[1];
    item.ficha_padrao_versao_id = padrao[2];
  }
  return item;
}

function opHtmlProdutoSelecionado(item, travado) {
  const codigo = item.produto_codigo || item.codigo;
  const meta = codigo ? `Código: ${opEsc(codigo)}` : 'Produto cadastrado';
  const acoes = travado ? '' : `
      <div class="d-flex align-items-center">
        <button type="button" class="btn btn-link btn-sm p-0 me-1" data-op-alterar>Alterar produto</button>
        <button type="button" class="btn btn-link btn-sm ft-limpar" data-op-limpar aria-label="Remover produto">×</button>
      </div>`;
  return `
    <div class="ft-selecionado" data-op-selecionado>
      <div>
        <strong>${opEsc(item.produto_nome || item.descricao || item.nome || '')}</strong>
        <div class="ft-selecionado-meta">${meta}</div>
      </div>
      ${acoes}
    </div>`;
}

function opHtmlBuscaProduto() {
  return '<input class="form-control form-control-sm" data-campo="busca" placeholder="Buscar produto..." autocomplete="off">';
}

function opHtmlItem(item, travado) {
  const atual = item || {};
  const produto = atual.produto_id ? opHtmlProdutoSelecionado(atual, travado) : opHtmlBuscaProduto();
  const incluir = atual.selecionavel
    ? `<div class="form-check mb-1"><input class="form-check-input" type="checkbox" data-op-incluir checked><label class="form-check-label">Incluir</label></div>`
    : '';
  const maximo = atual.maximo != null && atual.maximo !== ''
    ? `<div class="small text-muted">Máximo: ${opEsc(atual.maximo)}</div><input type="hidden" data-campo="maximo" value="${opEsc(atual.maximo)}">`
    : '';
  return `
    <div class="ft-linha op-linha-item" data-op-linha="item">
      <div class="ft-busca">
        ${incluir}
        <label class="form-label mb-1">Produto</label>
        ${produto}
        <input type="hidden" data-campo="id" value="${atual.id ? opEsc(atual.id) : ''}">
        <input type="hidden" data-campo="produto_id" value="${atual.produto_id ? opEsc(atual.produto_id) : ''}">
        <input type="hidden" data-campo="necessidade_item_id" value="${atual.necessidade_item_id ? opEsc(atual.necessidade_item_id) : ''}">
      </div>
      <div>
        <label class="form-label mb-1">Quantidade</label>
        <input class="form-control form-control-sm" data-campo="quantidade_planejada" value="${atual.quantidade_planejada == null ? '' : opEsc(atual.quantidade_planejada)}" inputmode="decimal">
        ${maximo}
      </div>
      <div>
        <label class="form-label mb-1">Unidade</label>
        <input class="form-control form-control-sm" data-campo="unidade" value="${opEsc(atual.unidade)}" placeholder="UN, KG, L">
      </div>
      <div>
        <label class="form-label mb-1">Ficha técnica</label>
        ${opHtmlFicha(atual, atual.produto_id)}
      </div>
      ${travado ? '' : '<button type="button" class="btn btn-outline-danger btn-sm" data-op-remover>Remover</button>'}
    </div>`;
}

function opCampo(linha, nome) {
  const campo = linha.querySelector(`[data-campo="${nome}"]`);
  return campo ? campo.value : '';
}

function opColetar() {
  return {
    origem: document.getElementById('op-origem').value,
    data_prevista: document.getElementById('op-data').value,
    prioridade: document.getElementById('op-prioridade').value,
    observacao: document.getElementById('op-observacao').value,
    necessidade_id: document.getElementById('op-necessidade-id').value,
    itens: Array.from(document.querySelectorAll('#op-itens [data-op-linha]')).filter((linha) => {
      const marca = linha.querySelector('[data-op-incluir]');
      return !marca || marca.checked;
    }).map((linha) => ({
      produto_id: opCampo(linha, 'produto_id'),
      necessidade_item_id: opCampo(linha, 'necessidade_item_id'),
      quantidade_planejada: opCampo(linha, 'quantidade_planejada'),
      unidade: opCampo(linha, 'unidade'),
      id: opCampo(linha, 'id'),
      ...opColetarFicha(linha),
      maximo: opCampo(linha, 'maximo')
    }))
  };
}

function opMostrarErro(mensagem) {
  const aviso = document.getElementById('op-erro');
  if (!aviso) return;
  aviso.textContent = mensagem;
  aviso.classList.remove('d-none');
}

function opFechar() {
  const editor = document.getElementById('op-editor');
  const lista = document.getElementById('op-lista-painel');
  if (editor) {
    editor.hidden = true;
    editor.innerHTML = '';
  }
  if (lista) lista.hidden = false;
}

function opSugestoes(ancora, itens, aoEscolher, opcoes) {
  const antiga = ancora.querySelector('.ft-sugestoes');
  if (antiga) antiga.remove();
  const lista = document.createElement('ul');
  lista.className = 'ft-sugestoes';
  if (!itens.length) {
    if (!(opcoes && opcoes.vazio)) return;
    const vazio = document.createElement('li');
    vazio.className = 'px-2 py-2 text-muted small';
    vazio.textContent = 'Nenhum produto encontrado.';
    lista.appendChild(vazio);
    ancora.appendChild(lista);
    return;
  }
  itens.forEach((item) => {
    const li = document.createElement('li');
    const botao = document.createElement('button');
    botao.type = 'button';
    if (item.produto) {
      const nome = document.createElement('span');
      nome.textContent = item.produto.nome || '';
      const meta = document.createElement('span');
      meta.className = 'ft-sugestao-meta';
      meta.textContent = 'Código: ' + (item.produto.codigo || '—');
      botao.append(nome, meta);
    } else {
      botao.textContent = item.rotulo || '';
    }
    botao.addEventListener('click', () => {
      aoEscolher(item);
      lista.remove();
    });
    li.appendChild(botao);
    lista.appendChild(li);
  });
  ancora.appendChild(lista);
}

function opAplicarProduto(linha, produto) {
  const busca = linha.querySelector('.ft-busca');
  const produtoId = linha.querySelector('[data-campo="produto_id"]');
  if (produtoId) produtoId.value = produto.id || '';
  const unidade = linha.querySelector('[data-campo="unidade"]');
  if (unidade && !unidade.value && produto.unidade) unidade.value = produto.unidade;
  busca.querySelectorAll('.ft-selecionado, [data-campo="busca"], .ft-sugestoes').forEach((no) => no.remove());
  busca.querySelector('label').insertAdjacentHTML('afterend', opHtmlProdutoSelecionado({
    produto_nome: produto.nome,
    produto_codigo: produto.codigo
  }, false));
  const ficha = linha.querySelector('[data-campo="ficha_escolhida"]');
  if (ficha) {
    ficha.disabled = true;
    opCarregarVinculosProduto(produto.id).done(() => {
      ficha.outerHTML = opHtmlFicha({}, produto.id);
    }).fail((err) => {
      ficha.disabled = false;
      opMostrarErro(opErro(err, 'Não foi possível carregar as fichas vinculadas ao produto.'));
    });
  }
}

function opVoltarBusca(linha) {
  const busca = linha.querySelector('.ft-busca');
  const produtoId = linha.querySelector('[data-campo="produto_id"]');
  if (produtoId) produtoId.value = '';
  busca.querySelectorAll('.ft-selecionado, [data-campo="busca"], .ft-sugestoes').forEach((no) => no.remove());
  busca.querySelector('label').insertAdjacentHTML('afterend', opHtmlBuscaProduto());
  const ficha = linha.querySelector('[data-campo="ficha_escolhida"]');
  if (ficha) ficha.outerHTML = opHtmlFicha({}, '');
  const campo = busca.querySelector('[data-campo="busca"]');
  if (campo) campo.focus();
}

function opBuscarProduto(termo, ancora, aoEscolher) {
  const q = String(termo || '').trim();
  if (q.length < 2) {
    const antiga = ancora.querySelector('.ft-sugestoes');
    if (antiga) antiga.remove();
    return;
  }
  $.ajax({
    url: API_URL + '/fabrica-loja/produtos-produzidos?q=' + encodeURIComponent(q),
    method: 'GET',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).done((resposta) => {
    const produtos = (resposta && resposta.produtos) || [];
    opSugestoes(ancora, produtos.slice(0, 8).map((produto) => ({ produto })), (item) => aoEscolher(item.produto), { vazio: true });
  });
}

function opAbrirFormulario(ordem, cobertura) {
  const atual = ordem || {
    id: null,
    codigo: '',
    status: 'RASCUNHO',
    origem: cobertura ? 'NECESSIDADE' : 'MANUAL',
    prioridade: 'NORMAL',
    data_prevista: '',
    observacao: '',
    necessidade_id: cobertura ? cobertura.necessidade_id : null,
    itens: []
  };
  const ligada = Boolean(atual.necessidade_id || cobertura);
  const itens = cobertura
    ? cobertura.itens.filter((item) => Number(item.restante) > 0).map((item) => ({
      necessidade_item_id: item.necessidade_item_id,
      produto_id: item.produto_id,
      produto_nome: item.descricao,
      quantidade_planejada: item.restante,
      unidade: item.unidade,
      ficha_tecnica_id: item.ficha_tecnica_id,
      ficha_padrao_vinculo_id: item.ficha_padrao_vinculo_id,
      ficha_padrao_versao_id: item.ficha_padrao_versao_id,
      ficha_padrao_snapshot: item.ficha_padrao_snapshot,
      selecionavel: true,
      maximo: item.restante
    }))
    : (atual.itens || []);
  const origens = (ligada ? OP_ORIGENS : OP_ORIGENS.filter((item) => item.id !== 'NECESSIDADE')).map((origem) => {
    const marca = origem.id === atual.origem ? ' selected' : '';
    return `<option value="${origem.id}"${marca}>${opEsc(origem.nome)}</option>`;
  }).join('');
  const prioridades = OP_PRIORIDADES.map((item) => {
    const marca = item.id === (atual.prioridade || 'NORMAL') ? ' selected' : '';
    return `<option value="${item.id}"${marca}>${opEsc(item.nome)}</option>`;
  }).join('');
  const editor = document.getElementById('op-editor');
  editor.hidden = false;
  editor.innerHTML = `
    <form id="op-form" class="card" autocomplete="off">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
          <h2 class="h5 mb-0">${atual.id ? opEsc(atual.codigo) : 'Nova ordem de produção'}</h2>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="op-voltar">Voltar</button>
        </div>
        <div id="op-erro" class="alert alert-danger d-none" role="alert"></div>
        <input type="hidden" id="op-id" value="${atual.id ? opEsc(atual.id) : ''}">
        <input type="hidden" id="op-necessidade-id" value="${atual.necessidade_id ? opEsc(atual.necessidade_id) : ''}">
        ${cobertura ? `<p class="ft-aviso">Necessidade ${opEsc(cobertura.codigo)}. A quantidade sugerida é o máximo permitido. Planejar menos é permitido. Criar a ordem não produz e não atende a necessidade.</p>` : ''}
        <div class="row g-2">
          <div class="col-md-4">
            <label class="form-label" for="op-origem">Origem</label>
            <select class="form-select" id="op-origem" ${ligada ? 'disabled' : ''}>${origens}</select>
          </div>
          <div class="col-md-4">
            <label class="form-label" for="op-prioridade">Prioridade</label>
            <select class="form-select" id="op-prioridade">${prioridades}</select>
          </div>
          <div class="col-md-4">
            <label class="form-label" for="op-data">Data prevista</label>
            <input class="form-control" id="op-data" type="date" value="${opEsc(atual.data_prevista)}">
          </div>
          <div class="col-12">
            <label class="form-label" for="op-observacao">Observação</label>
            <textarea class="form-control" id="op-observacao" rows="2">${opEsc(atual.observacao)}</textarea>
          </div>
        </div>
        <div class="ft-bloco mt-3">
          <div class="d-flex justify-content-between align-items-center">
            <h3>O que produzir</h3>
            ${ligada ? '' : '<button type="button" class="btn btn-outline-primary btn-sm" id="op-adicionar-item">Adicionar produto</button>'}
          </div>
          <div id="op-itens"></div>
        </div>
      </div>
      <div class="card-footer d-flex gap-2 justify-content-end">
        <button type="submit" class="btn btn-success" id="op-salvar">Salvar rascunho</button>
      </div>
    </form>`;
  document.getElementById('op-itens').innerHTML = (itens.length ? itens : [{}]).map((item) => opHtmlItem(item, ligada)).join('');
  document.getElementById('op-lista-painel').hidden = true;
}

function opPercentual(produzida, planejada) {
  if (!(Number(planejada) > 0) || !Number.isFinite(Number(produzida))) return '—';
  const valor = Math.round((Number(produzida) / Number(planejada)) * 1000) / 10;
  const texto = Number.isInteger(valor) ? String(valor) : String(valor).replace('.', ',');
  return texto + '%';
}

function opHtmlExecucao(execucao) {
  if (!execucao || !execucao.snapshot) return '';
  const produzidos = execucao.snapshot.produzidos || [];
  const consumos = execucao.snapshot.consumos || [];
  const item = produzidos[0] || {};
  const ficha = item.ficha;
  const planejado = execucao.quantidade_planejada != null ? execucao.quantidade_planejada : item.quantidade_planejada;
  const produzido = execucao.quantidade_produzida != null ? execucao.quantidade_produzida : item.quantidade_produzida;
  const perdido = execucao.quantidade_perdida != null ? execucao.quantidade_perdida : (item.quantidade_perdida || 0);
  const unidade = execucao.unidade || item.unidade || '';
  const rendimento = execucao.rendimento_real != null ? execucao.rendimento_real : item.rendimento_real;
  const motivo = execucao.motivo_perda || item.motivo_perda || '';
  const observacao = execucao.observacao_perda || item.observacao_perda || '';
  return `
    <div class="alert alert-success">Produção concluída. Esta ordem não oferece nova execução.</div>
    <div class="ft-bloco">
      <h3>Execução</h3>
      <div>Data/hora: ${opEsc(opData(execucao.concluida_em || execucao.created_at) || execucao.created_at || '')}</div>
      <div>Usuário: ${opEsc(execucao.usuario_nome || '—')}</div>
      ${produzidos.length > 1
        ? produzidos.map((linha) => `<div>${opEsc(linha.produto_nome || '—')}: planejado ${opEsc(linha.quantidade_planejada)} · produzido ${opEsc(linha.quantidade_produzida)} · perdido ${opEsc(linha.quantidade_perdida || 0)} ${opEsc(linha.unidade || unidade)}</div>`).join('')
        : `<div>Planejado: ${opEsc(planejado)} ${opEsc(unidade)}</div>
      <div>Processado: ${opEsc(planejado)} ${opEsc(unidade)}</div>
      <div>Produzido: ${opEsc(produzido)} ${opEsc(unidade)}</div>
      <div>Perdido: ${opEsc(perdido)} ${opEsc(unidade)}</div>`}
      <div>Rendimento da ficha: ${ficha ? opEsc(ficha.rendimento_quantidade) + ' ' + opEsc(ficha.rendimento_unidade) : '—'}</div>
      <div>Rendimento real: ${rendimento == null ? '—' : opEsc(String(rendimento).replace('.', ',')) + '%'}</div>
      <div>Ficha utilizada: ${ficha ? opEsc(ficha.codigo) + ' — ' + opEsc(ficha.nome) : '—'}</div>
      <div>Local: ${opEsc(execucao.local || 'FABRICA')}</div>
    </div>
    <div class="ft-bloco">
      <h3>Perda</h3>
      <div>Motivo: ${opEsc(motivo || '—')}</div>
      <div>Observação: ${opEsc(observacao || '—')}</div>
    </div>
    <div class="ft-bloco">
      <h3>Consumo</h3>
      ${consumos.map((consumo) => `<div>${opEsc(consumo.nome)}: ${opEsc(consumo.quantidade)} ${opEsc(consumo.unidade)}</div>`).join('') || '<div>—</div>'}
    </div>
    <div class="ft-bloco">
      <h3>Resultado</h3>
      ${produzidos.map((produzidoItem) => `<div>${opEsc(produzidoItem.produto_nome || '—')}: ${opEsc(produzidoItem.quantidade_produzida)} ${opEsc(produzidoItem.unidade || unidade)} na fábrica${Number(produzidoItem.quantidade_perdida) > 0 ? ` · perda ${opEsc(produzidoItem.quantidade_perdida)}` : ''}</div>`).join('') || '<div>—</div>'}
    </div>`;
}

function opTempo(inicio, fim) {
  const ler = (valor) => {
    const texto = String(valor || '');
    const data = texto.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!data) return null;
    return new Date(Number(data[1]), Number(data[2]) - 1, Number(data[3]), Number(data[4]), Number(data[5]), Number(data[6] || 0)).getTime();
  };
  const a = ler(inicio);
  const b = ler(fim);
  if (a == null || b == null || b < a) return '';
  const minutos = Math.round((b - a) / 60000);
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas <= 0) return resto + 'min';
  return horas + 'h' + String(resto).padStart(2, '0');
}

function opHtmlPrevia(previa) {
  if (!previa) return '<div class="text-muted">Carregando prévia...</div>';
  const linhas = (previa.insumos || previa.consumos || []).map((item) => `<tr>
    <td>${opEsc(item.produto_nome)}</td>
    <td class="text-end">${opEsc(item.necessario != null ? item.necessario : item.quantidade)} ${opEsc(item.unidade)}</td>
    <td class="text-end">${opEsc(item.disponivel_fabrica)} ${opEsc(item.unidade)}</td>
    <td>${opEsc(item.situacao || '')}</td>
  </tr>`).join('');
  const produtos = (previa.itens || []).map((item) => `<div><strong>${opEsc(item.produto_nome)}</strong> ${opEsc(item.quantidade_planejada)} ${opEsc(item.unidade)}</div><div class="small text-muted">${opEsc(item.ficha_codigo || '')} ${opEsc(item.ficha_nome || '')}</div>`).join('');
  return `<div class="ft-bloco">
    <h3>Prévia da produção</h3>
    ${produtos}
    <div class="mt-2">Produção será realizada na: <strong>${opEsc(previa.local || 'FABRICA')}</strong></div>
    <div class="table-responsive mt-2">
      <table class="table table-sm mb-0">
        <thead><tr><th>Insumo</th><th class="text-end">Necessário</th><th class="text-end">Saldo fábrica</th><th>Situação</th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="4">—</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
}

function opHtmlRegistro(ordem) {
  const itens = ordem.itens || [];
  if (itens.length > 1) {
    return `<div class="ft-bloco" id="op-registro">
      <h3>Registrar produção</h3>
      <p>Produção em andamento.</p>
      ${itens.map((item) => `<div class="border rounded p-2 mb-2" data-op-resultado="${opEsc(item.produto_id)}">
        <strong>${opEsc(item.produto_nome)}</strong>
        <div class="small text-muted">Planejado: ${opEsc(item.quantidade_planejada)} ${opEsc(item.unidade)}</div>
        <div class="row g-2 mt-1">
          <div class="col-6"><label class="form-label mb-1">Quantidade produzida</label><input class="form-control form-control-sm" data-op-produzida value="${opEsc(item.quantidade_planejada)}"></div>
          <div class="col-6"><label class="form-label mb-1">Quantidade perdida</label><input class="form-control form-control-sm" data-op-perdida value="0"></div>
        </div>
      </div>`).join('')}
      <label class="form-label mb-1" for="op-motivo-perda">Motivo da perda</label>
      <input class="form-control mb-2" id="op-motivo-perda" maxlength="80">
      <label class="form-label mb-1" for="op-obs-perda">Observação</label>
      <textarea class="form-control" id="op-obs-perda" rows="2" maxlength="300"></textarea>
    </div>`;
  }
  const item = itens[0] || {};
  return `<div class="ft-bloco" id="op-registro">
    <h3>Registrar produção</h3>
    <p>Produção em andamento.</p>
    <div>Iniciada em: <strong>${opEsc(opData(ordem.producao_iniciada_em) || '—')}</strong></div>
    <div class="row g-2 mt-2">
      <div class="col-md-6"><label class="form-label mb-1" for="op-qtd-produzida">Quantidade produzida</label><input class="form-control" id="op-qtd-produzida" value="${opEsc(item.quantidade_planejada)}"></div>
      <div class="col-md-6"><label class="form-label mb-1" for="op-qtd-perdida">Quantidade perdida</label><input class="form-control" id="op-qtd-perdida" value="0"></div>
      <div class="col-12"><label class="form-label mb-1" for="op-motivo-perda">Motivo da perda</label><input class="form-control" id="op-motivo-perda" maxlength="80"></div>
      <div class="col-12"><label class="form-label mb-1" for="op-obs-perda">Observação</label><textarea class="form-control" id="op-obs-perda" rows="2" maxlength="300"></textarea></div>
    </div>
  </div>`;
}

function opAbrirDetalhe(ordem, execucao) {
  const item = (ordem.itens && ordem.itens[0]) || {};
  const ficha = item.ficha;
  const editor = document.getElementById('op-editor');
  const podeEditar = ordem.status === 'RASCUNHO';
  const podePlanejar = ordem.status === 'RASCUNHO';
  const podeIniciar = ordem.status === 'PLANEJADA';
  const podeCancelar = ordem.status === 'RASCUNHO' || ordem.status === 'PLANEJADA';
  editor.hidden = false;
  editor.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
          <div>
            <h2 class="h4 mb-1">${opEsc(ordem.codigo)}</h2>
            <div class="fs-5">${opEsc(item.produto_nome || '')}</div>
          </div>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="op-voltar">Voltar</button>
        </div>
        <div id="op-erro" class="alert alert-danger d-none" role="alert"></div>
        <div class="row g-3">
          <div class="col-md-3"><div class="text-muted small">Quantidade planejada</div><strong>${opEsc(item.quantidade_planejada)} ${opEsc(item.unidade)}</strong></div>
          <div class="col-md-3"><div class="text-muted small">Status</div><strong>${opEsc(opNomeStatus(ordem.status))}</strong></div>
          <div class="col-md-3"><div class="text-muted small">Prioridade</div><strong>${opEsc(ordem.prioridade)}</strong></div>
          <div class="col-md-3"><div class="text-muted small">Data prevista</div><strong>${opEsc(opData(ordem.data_prevista) || '—')}</strong></div>
          <div class="col-md-6"><div class="text-muted small">Origem</div><strong>${opEsc(opNomeOrigem(ordem.origem))}</strong></div>
          <div class="col-md-6"><div class="text-muted small">Ficha técnica</div><strong>${ficha ? opEsc(ficha.nome) : 'Sem ficha'}</strong></div>
        </div>
        <div class="ft-bloco mt-3">
          <h3>Origem</h3>
          ${ordem.necessidade_id ? `<div>Necessidade: ${opEsc(ordem.necessidade_codigo || ordem.necessidade_id)}</div>` : '<div>Sem necessidade vinculada.</div>'}
          ${ordem.referencia ? `<div class="small text-muted mt-1">${opEsc(ordem.referencia)}</div>` : ''}
          ${ordem.usuario_nome ? `<div class="small text-muted mt-1">Responsável: ${opEsc(ordem.usuario_nome)}</div>` : ''}
        </div>
        <div class="ft-bloco">
          <h3>Ficha técnica</h3>
          ${ficha ? `<div>Nome: ${opEsc(ficha.nome)}</div><div>Código: ${opEsc(ficha.codigo)}</div><div>Status: ${opEsc(ficha.status)}</div>` : '<div>Sem ficha técnica vinculada.</div>'}
        </div>
        <div class="ft-bloco">
          <h3>Observações</h3>
          <div>${opEsc(ordem.observacao || '—')}</div>
        </div>
        ${ordem.status === 'EM_PRODUCAO' ? `<div class="mt-3">Iniciada em: <strong>${opEsc(opData(ordem.producao_iniciada_em) || '—')}</strong>${ordem.producao_usuario_nome ? ' · ' + opEsc(ordem.producao_usuario_nome) : ''}</div>` : ''}
        ${ordem.status === 'CONCLUIDA' && execucao ? `<div class="ft-bloco mt-3">
          <div>Planejado: <strong>${opEsc(execucao.quantidade_planejada)}</strong></div>
          <div>Produzido: <strong>${opEsc(execucao.quantidade_produzida)}</strong></div>
          <div>Perdido: <strong>${opEsc(execucao.quantidade_perdida)}</strong></div>
          <div>Rendimento: <strong>${execucao.rendimento_real == null ? '—' : opEsc(execucao.rendimento_real) + '%'}</strong></div>
          <div>Início: <strong>${opEsc(opData(ordem.producao_iniciada_em || execucao.iniciada_em) || '—')}</strong></div>
          <div>Finalização: <strong>${opEsc(opData(execucao.concluida_em) || '—')}</strong></div>
          <div>Tempo: <strong>${opEsc(opTempo(ordem.producao_iniciada_em || execucao.iniciada_em, execucao.concluida_em) || '—')}</strong></div>
          <div>Produto produzido: <strong>${opEsc(execucao.quantidade_produzida)} ${opEsc(execucao.unidade)}</strong></div>
        </div>` : ''}
        ${(ordem.status === 'PLANEJADA' || ordem.status === 'EM_PRODUCAO') ? '<div id="op-previa"></div>' : ''}
        ${ordem.status === 'EM_PRODUCAO' ? opHtmlRegistro(ordem) : ''}
        ${opHtmlExecucao(execucao)}
      </div>
      <div class="card-footer d-flex gap-2 justify-content-end flex-wrap">
        ${podeEditar ? `<button type="button" class="btn btn-outline-primary" id="op-editar" data-op-id="${opEsc(ordem.id)}">Editar</button>` : ''}
        ${podePlanejar ? `<button type="button" class="btn btn-success" data-op-planejar="${opEsc(ordem.id)}">Planejar Produção</button>` : ''}
        ${podeIniciar ? `<button type="button" class="btn btn-success" data-op-iniciar="${opEsc(ordem.id)}">Iniciar Produção</button>` : ''}
        ${ordem.status === 'EM_PRODUCAO' ? `<button type="button" class="btn btn-success" data-op-finalizar="${opEsc(ordem.id)}">Finalizar produção</button>` : ''}
        ${opBotaoTransferir(ordem, execucao)}
        ${podeCancelar ? `<button type="button" class="btn btn-outline-warning" data-op-cancelar="${opEsc(ordem.id)}">Cancelar</button>` : ''}
      </div>
    </div>`;
  document.getElementById('op-lista-painel').hidden = true;
  if (ordem.status === 'PLANEJADA' || ordem.status === 'EM_PRODUCAO') {
    opApi('GET', '/fabrica-loja/ordens-producao/' + ordem.id + '/previa-producao').done((resposta) => {
      const alvo = document.getElementById('op-previa');
      if (alvo) alvo.innerHTML = opHtmlPrevia(resposta.previa);
    }).fail((err) => {
      const alvo = document.getElementById('op-previa');
      if (alvo) alvo.innerHTML = `<div class="alert alert-danger">${opEsc(opErro(err, 'Não foi possível preparar a produção.'))}</div>`;
    });
  }
}

function opCarregarLista() {
  const params = new URLSearchParams();
  const status = document.getElementById('op-filtro-status');
  const produto = document.getElementById('op-filtro-produto');
  const prioridade = document.getElementById('op-filtro-prioridade');
  const inicio = document.getElementById('op-filtro-inicio');
  const fim = document.getElementById('op-filtro-fim');
  if (status && status.value) params.set('status', status.value);
  if (produto && produto.value.trim()) params.set('produto', produto.value.trim());
  if (prioridade && prioridade.value) params.set('prioridade', prioridade.value);
  if (inicio && inicio.value) params.set('inicio', inicio.value);
  if (fim && fim.value) params.set('fim', fim.value);
  const consulta = params.toString();
  opApi('GET', '/fabrica-loja/ordens-producao' + (consulta ? '?' + consulta : '')).done((resposta) => {
    const corpo = document.getElementById('op-tbody');
    if (!corpo) return;
    const ordens = (resposta && resposta.ordens) || [];
    if (!ordens.length) {
      corpo.innerHTML = '<tr><td colspan="10" class="text-muted">Nenhuma ordem de produção encontrada.</td></tr>';
      return;
    }
    corpo.innerHTML = ordens.map((ordem) => {
      const editar = ordem.status === 'RASCUNHO' ? `<button type="button" class="btn btn-sm btn-outline-primary" data-op-editar="${ordem.id}">Editar</button>` : '';
      const planejar = ordem.status === 'RASCUNHO' ? `<button type="button" class="btn btn-sm btn-success" data-op-planejar="${ordem.id}">Planejar Produção</button>` : '';
      const iniciar = ordem.status === 'PLANEJADA' ? `<button type="button" class="btn btn-sm btn-success" data-op-iniciar="${ordem.id}">Iniciar Produção</button>` : '';
      const continuar = ordem.status === 'EM_PRODUCAO' ? `<button type="button" class="btn btn-sm btn-success" data-op-ver="${ordem.id}">Continuar produção</button>` : '';
      const cancelar = ordem.status === 'RASCUNHO' || ordem.status === 'PLANEJADA'
        ? `<button type="button" class="btn btn-sm btn-outline-warning" data-op-cancelar="${ordem.id}">Cancelar</button>` : '';
      const nome = ordem.itens > 1 ? `${ordem.produto_nome} (+${ordem.itens - 1})` : (ordem.produto_nome || '');
      return `<tr>
        <td>${opEsc(ordem.codigo)}</td>
        <td>${opEsc(nome)}</td>
        <td>${opEsc(ordem.quantidade_planejada)}</td>
        <td>${opEsc(ordem.unidade)}</td>
        <td>${opEsc(opNomeOrigem(ordem.origem))}</td>
        <td>${opEsc(ordem.prioridade)}</td>
        <td>${opEsc(opData(ordem.data_prevista))}</td>
        <td>${opEsc(opNomeStatus(ordem.status))}</td>
        <td>${opEsc(opData(ordem.updated_at))}</td>
        <td class="text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-op-ver="${ordem.id}">Visualizar</button>
          ${editar} ${planejar} ${iniciar} ${continuar} ${cancelar}
        </td>
      </tr>`;
    }).join('');
  }).fail((err) => {
    showNotification(opErro(err, 'Não foi possível carregar as ordens.'), 'error');
  });
}

function opAbrir(id, editar) {
  opCarregarFichas().always(() => {
    opApi('GET', '/fabrica-loja/ordens-producao/' + id).done((resposta) => {
      if (editar && resposta.ordem.status === 'RASCUNHO') {
        opCarregarVinculosItens(resposta.ordem.itens).done(() => {
          opAbrirFormulario(resposta.ordem);
        }).fail((err) => showNotification(opErro(err, 'Não foi possível carregar as fichas vinculadas aos produtos.'), 'error'));
        return;
      }
      if (resposta.ordem.status !== 'CONCLUIDA') {
        opAbrirDetalhe(resposta.ordem);
        return;
      }
      opApi('GET', '/fabrica-loja/ordens-producao/' + id + '/execucoes').done((lista) => {
        const execucoes = (lista && lista.execucoes) || [];
        opAbrirDetalhe(resposta.ordem, execucoes[execucoes.length - 1] || null);
      }).fail(() => opAbrirDetalhe(resposta.ordem));
    }).fail((err) => showNotification(opErro(err, 'Não foi possível abrir a ordem.'), 'error'));
  });
}

function opTextoFalta(err) {
  const corpo = err && err.responseJSON;
  const faltas = (corpo && corpo.detalhes) || [];
  if (!faltas.length) return opErro(err, 'Não foi possível executar a produção.');
  const linhas = faltas.map((item) => `${item.produto}: necessário ${item.necessario} ${item.unidade}, disponível ${item.disponivel} ${item.unidade}, faltante ${item.faltante} ${item.unidade}`);
  return `${corpo.error} ${linhas.join(' ')}`;
}

function opBotaoTransferir(ordem, execucao) {
  if (!ordem || ordem.status !== 'CONCLUIDA' || !execucao) return '';
  return `<button type="button" class="btn btn-primary" data-op-transferir="${opEsc(ordem.id)}" data-ordem="${opEsc(ordem.codigo)}">Transferir para Loja</button>`;
}

function opTransferirParaLoja(id, codigo) {
  opApi('GET', '/fabrica-loja/ordens-producao/' + id + '/transferencia-sugerida').done((resposta) => {
    const sugestao = (resposta && resposta.sugestao) || {};
    const itens = sugestao.itens || [];
    if (!itens.length) {
      showNotification(sugestao.mensagem || 'Nenhum produto produzido está disponível para transferência para a Loja.', 'warning');
      return;
    }
    window._trfOrigemProducao = { ordem: codigo || sugestao.codigo || '', itens: itens };
    if (typeof loadPage === 'function') loadPage('transferencias');
  }).fail((err) => showNotification(opErro(err, 'Não foi possível preparar a transferência.'), 'error'));
}

function opAbrirConfirmacao(id) {
  opApi('GET', '/fabrica-loja/ordens-producao/' + id + '/previa-producao').fail((err) => {
    showNotification(opErro(err, 'Não foi possível preparar a produção.'), 'error');
  }).done((resposta) => {
    const previa = resposta.previa || {};
    const produto = (previa.itens && previa.itens[0]) || {};
    const planejada = Number(produto.quantidade_planejada != null ? produto.quantidade_planejada : produto.quantidade);
    const correlation = `op-${id}-${Date.now()}`;
    $('#modalIniciarProducao').remove();
    $('body').append(`
      <div class="modal fade" id="modalIniciarProducao" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Executar produção</h5></div>
            <div class="modal-body">
              <p><strong>Produto:</strong> ${opEsc(produto.produto_nome || '')}</p>
              <p><strong>Quantidade planejada:</strong> ${opEsc(planejada)} ${opEsc(produto.unidade)}</p>
              <p class="mb-1"><strong>Ficha:</strong> ${opEsc(produto.ficha_codigo || '—')} ${opEsc(produto.ficha_nome || '')}</p>
              <p class="mb-1"><strong>Rendimento da ficha:</strong> ${opEsc(produto.rendimento_ficha)} ${opEsc(produto.rendimento_unidade)}</p>
              <p class="mb-1"><strong>Insumos na fábrica:</strong></p>
              <ul>${(previa.consumos || []).map((item) => `<li>${opEsc(item.produto_nome)}<br>Necessário: ${opEsc(item.quantidade)} ${opEsc(item.unidade)}<br>Fábrica: ${opEsc(item.disponivel_fabrica)} ${opEsc(item.unidade)}</li>`).join('')}</ul>
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label mb-1" for="op-qtd-produzida">Quantidade produzida</label>
                  <input class="form-control" id="op-qtd-produzida" type="number" min="0" step="0.001" value="${opEsc(planejada)}">
                </div>
                <div class="col-6">
                  <label class="form-label mb-1" for="op-qtd-perdida">Quantidade perdida</label>
                  <input class="form-control" id="op-qtd-perdida" type="number" min="0" step="0.001" value="0">
                </div>
                <div class="col-12">
                  <label class="form-label mb-1" for="op-motivo-perda">Motivo da perda</label>
                  <input class="form-control" id="op-motivo-perda" maxlength="80" placeholder="Quebra, erro, derramamento">
                </div>
                <div class="col-12">
                  <label class="form-label mb-1" for="op-obs-perda">Observação da perda</label>
                  <textarea class="form-control" id="op-obs-perda" rows="2" maxlength="300"></textarea>
                </div>
              </div>
              <p class="mb-1">Rendimento previsto: 100%</p>
              <p>Rendimento real: <strong id="op-rendimento-real">100%</strong></p>
              <p class="text-muted small mb-0">A perda não entra no estoque. O produto produzido permanece na fábrica.</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-success" id="op-confirmar-producao" data-correlation="${opEsc(correlation)}">Confirmar Produção</button>
            </div>
          </div>
        </div>
      </div>`);
    const modal = new bootstrap.Modal(document.getElementById('modalIniciarProducao'));
    const campoProduzida = document.getElementById('op-qtd-produzida');
    const campoPerdida = document.getElementById('op-qtd-perdida');
    let ajustando = false;
    function atualizarRendimento() {
      const produzida = Number(campoProduzida.value);
      document.getElementById('op-rendimento-real').textContent = opPercentual(produzida, planejada);
    }
    campoProduzida.addEventListener('input', () => {
      if (ajustando) return;
      ajustando = true;
      const produzida = Number(campoProduzida.value);
      if (Number.isFinite(produzida)) campoPerdida.value = String(Math.round((planejada - produzida) * 1000) / 1000);
      ajustando = false;
      atualizarRendimento();
    });
    campoPerdida.addEventListener('input', () => {
      if (ajustando) return;
      ajustando = true;
      const perdida = Number(campoPerdida.value);
      if (Number.isFinite(perdida)) campoProduzida.value = String(Math.round((planejada - perdida) * 1000) / 1000);
      ajustando = false;
      atualizarRendimento();
    });
    modal.show();
    document.getElementById('op-confirmar-producao').addEventListener('click', function confirmar() {
      const botao = this;
      const produzida = Number(campoProduzida.value);
      const perdida = Number(campoPerdida.value);
      if (!Number.isFinite(produzida) || produzida < 0) {
        showNotification('A quantidade produzida não pode ser negativa.', 'error');
        return;
      }
      if (!Number.isFinite(perdida) || perdida < 0) {
        showNotification('A quantidade perdida não pode ser negativa.', 'error');
        return;
      }
      if (produzida > planejada) {
        showNotification('A quantidade produzida não pode ser superior à quantidade processada.', 'error');
        return;
      }
      if (Math.abs((produzida + perdida) - planejada) > 0.001) {
        showNotification('A quantidade produzida + perda deve corresponder à quantidade planejada.', 'error');
        return;
      }
      botao.disabled = true;
      opApi('POST', '/fabrica-loja/ordens-producao/' + id + '/executar', {
        correlation_id: botao.getAttribute('data-correlation'),
        quantidade_produzida: produzida,
        quantidade_perdida: perdida,
        motivo_perda: document.getElementById('op-motivo-perda').value,
        observacao_perda: document.getElementById('op-obs-perda').value
      }).done(() => {
        modal.hide();
        showNotification('Produção concluída. O estoque foi movimentado na fábrica.', 'success');
        opAbrir(id, false);
        opCarregarLista();
      }).fail((err) => {
        botao.disabled = false;
        showNotification(opTextoFalta(err), 'error');
      });
    });
    document.getElementById('modalIniciarProducao').addEventListener('hidden.bs.modal', function() {
      $('#modalIniciarProducao').remove();
    });
  }).fail((err) => showNotification(opTextoFalta(err), 'error'));
}

function opComecar(id, botao) {
  if (botao) botao.disabled = true;
  opApi('POST', '/fabrica-loja/ordens-producao/' + id + '/em-producao').done(() => {
    showNotification('Produção iniciada. O estoque não foi movimentado.', 'success');
    opAbrir(id, false);
    opCarregarLista();
  }).fail((err) => {
    if (botao) botao.disabled = false;
    const mensagem = opTextoFalta(err);
    if (document.getElementById('op-erro')) opMostrarErro(mensagem);
    else showNotification(mensagem, 'error');
  });
}

function opFinalizar(id, botao) {
  if (botao) botao.disabled = true;
  const linhas = Array.from(document.querySelectorAll('[data-op-resultado]'));
  const dados = {
    correlation_id: 'op-' + id + '-' + Date.now(),
    motivo_perda: document.getElementById('op-motivo-perda') ? document.getElementById('op-motivo-perda').value : '',
    observacao_perda: document.getElementById('op-obs-perda') ? document.getElementById('op-obs-perda').value : ''
  };
  if (linhas.length) {
    dados.itens = linhas.map((linha) => ({
      produto_id: linha.getAttribute('data-op-resultado'),
      quantidade_produzida: linha.querySelector('[data-op-produzida]').value,
      quantidade_perdida: linha.querySelector('[data-op-perdida]').value,
      motivo_perda: dados.motivo_perda,
      observacao_perda: dados.observacao_perda
    }));
  } else {
    dados.quantidade_produzida = document.getElementById('op-qtd-produzida').value;
    dados.quantidade_perdida = document.getElementById('op-qtd-perdida').value;
  }
  opApi('POST', '/fabrica-loja/ordens-producao/' + id + '/executar', dados).done(() => {
    showNotification('Produção concluída. O estoque foi movimentado na fábrica.', 'success');
    opAbrir(id, false);
    opCarregarLista();
  }).fail((err) => {
    if (botao) botao.disabled = false;
    const mensagem = opTextoFalta(err);
    if (document.getElementById('op-erro')) opMostrarErro(mensagem);
    else showNotification(mensagem, 'error');
  });
}

function opPlanejar(id, botao) {
  if (botao) botao.disabled = true;
  opApi('POST', '/fabrica-loja/ordens-producao/' + id + '/planejar').done(() => {
    showNotification('Ordem planejada. Nenhuma produção foi executada.', 'success');
    opAbrir(id, false);
    opCarregarLista();
  }).fail((err) => {
    if (botao) botao.disabled = false;
    const mensagem = opErro(err, 'Não foi possível planejar a ordem.');
    if (document.getElementById('op-erro')) opMostrarErro(mensagem);
    else showNotification(mensagem, 'error');
  });
}

function opCancelar(id) {
  if (!window.confirm('Cancelar esta ordem? Isso não movimenta estoque.')) return;
  opApi('POST', '/fabrica-loja/ordens-producao/' + id + '/cancelar').done(() => {
    showNotification('Ordem cancelada.', 'success');
    opFechar();
    opCarregarLista();
  }).fail((err) => {
    const mensagem = opErro(err, 'Não foi possível cancelar a ordem.');
    if (document.getElementById('op-erro')) opMostrarErro(mensagem);
    else showNotification(mensagem, 'error');
  });
}

function loadOrdensProducao() {
  window.opFichas = null;
  const necessidadeInicial = window._opNecessidadeId;
  const abrirInicial = window._opAbrirId;
  const filtroInicial = window._opFiltroStatus;
  const novaInicial = window._opNova;
  window._opNecessidadeId = null;
  window._opAbrirId = null;
  window._opFiltroStatus = null;
  window._opNova = null;
  $('#page-content').html(`
    <div class="container mt-4 ft-pagina">
      <div id="op-lista-painel">
        <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
          <div>
            <h2 class="mb-1">Ordens de Produção</h2>
            <p class="ft-aviso mb-0">Uma ordem planejada pode ser produzida na fábrica. A execução baixa os insumos e entra o produto produzido.</p>
          </div>
          <button type="button" class="btn btn-success" id="op-nova">Nova ordem</button>
        </div>
        <div class="d-flex gap-3 align-items-end flex-wrap mb-3">
          <div>
            <label class="form-label mb-1" for="op-filtro-status">Status</label>
            <select class="form-select" id="op-filtro-status">
              <option value="">Todos</option>
              ${OP_STATUS.map((status) => `<option value="${status}">${opNomeStatus(status)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label mb-1" for="op-filtro-produto">Produto</label>
            <input class="form-control" id="op-filtro-produto" placeholder="Nome ou código" autocomplete="off">
          </div>
          <div>
            <label class="form-label mb-1" for="op-filtro-prioridade">Prioridade</label>
            <select class="form-select" id="op-filtro-prioridade">
              <option value="">Todas</option>
              ${OP_PRIORIDADES.map((item) => `<option value="${item.id}">${opEsc(item.nome)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label mb-1" for="op-filtro-inicio">De</label>
            <input class="form-control" id="op-filtro-inicio" type="date">
          </div>
          <div>
            <label class="form-label mb-1" for="op-filtro-fim">Até</label>
            <input class="form-control" id="op-filtro-fim" type="date">
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-bordered table-hover align-middle">
            <thead>
              <tr>
                <th>OP</th><th>Produto</th><th>Quantidade</th><th>Unidade</th><th>Origem</th>
                <th>Prioridade</th><th>Data prevista</th><th>Status</th><th>Atualizada em</th><th></th>
              </tr>
            </thead>
            <tbody id="op-tbody"><tr><td colspan="10" class="text-muted">Carregando...</td></tr></tbody>
          </table>
        </div>
      </div>
      <div id="op-editor" hidden></div>
    </div>
  `);

  const pagina = document.querySelector('.ft-pagina');
  pagina.addEventListener('click', (evento) => {
    const alvo = evento.target.closest('button') || evento.target;
    if (alvo.id === 'op-nova') {
      opCarregarFichas().always(() => opAbrirFormulario(null));
      return;
    }
    if (alvo.id === 'op-voltar') {
      opFechar();
      opCarregarLista();
      return;
    }
    if (alvo.closest('[data-op-alterar]') || alvo.closest('[data-op-limpar]')) {
      const linhaProduto = alvo.closest('[data-op-linha]');
      if (linhaProduto) opVoltarBusca(linhaProduto);
      return;
    }
    if (alvo.id === 'op-adicionar-item') {
      document.getElementById('op-itens').insertAdjacentHTML('beforeend', opHtmlItem({}, false));
      return;
    }
    if (alvo.closest('[data-op-remover]')) {
      const linha = alvo.closest('[data-op-linha]');
      const grupo = linha && linha.parentElement;
      if (linha) linha.remove();
      if (grupo && !grupo.querySelector('[data-op-linha]')) grupo.insertAdjacentHTML('beforeend', opHtmlItem({}, false));
      return;
    }
    const ver = alvo.getAttribute && alvo.getAttribute('data-op-ver');
    if (ver) {
      opAbrir(ver, false);
      return;
    }
    const editar = (alvo.id === 'op-editar' && alvo.getAttribute('data-op-id')) || (alvo.getAttribute && alvo.getAttribute('data-op-editar'));
    if (editar) {
      opAbrir(editar, true);
      return;
    }
    if (alvo.getAttribute && alvo.getAttribute('data-op-transferir')) {
      opTransferirParaLoja(alvo.getAttribute('data-op-transferir'), alvo.getAttribute('data-ordem'));
      return;
    }
    const iniciar = alvo.getAttribute && alvo.getAttribute('data-op-iniciar');
    if (iniciar) {
      opComecar(iniciar, alvo);
      return;
    }
    const finalizar = alvo.getAttribute && alvo.getAttribute('data-op-finalizar');
    if (finalizar) {
      opFinalizar(finalizar, alvo);
      return;
    }
    const planejar = alvo.getAttribute && alvo.getAttribute('data-op-planejar');
    if (planejar) {
      opPlanejar(planejar, alvo);
      return;
    }
    const cancelar = alvo.getAttribute && alvo.getAttribute('data-op-cancelar');
    if (cancelar) opCancelar(cancelar);
  });

  pagina.addEventListener('submit', (evento) => {
    if (!evento.target || evento.target.id !== 'op-form') return;
    evento.preventDefault();
    const botao = document.getElementById('op-salvar');
    const id = document.getElementById('op-id').value;
    const dados = opColetar();
    if (!dados.itens.length || dados.itens.some((item) => !String(item.produto_id || '').trim())) {
      opMostrarErro('Selecione um produto cadastrado para a ordem de produção.');
      return;
    }
    const acima = dados.itens.find((item) => {
      const maximo = Number(String(item.maximo).replace(',', '.'));
      const quantidade = Number(String(item.quantidade_planejada).replace(',', '.'));
      return Number.isFinite(maximo) && maximo >= 0 && item.maximo !== '' && quantidade > maximo + 0.000001;
    });
    if (acima) {
      opMostrarErro('A quantidade não pode passar do restante da necessidade.');
      return;
    }
    dados.itens.forEach((item) => { delete item.maximo; });
    if (document.getElementById('op-origem').disabled) dados.origem = 'NECESSIDADE';
    botao.disabled = true;
    const pedido = id
      ? opApi('PUT', '/fabrica-loja/ordens-producao/' + id, dados)
      : opApi('POST', '/fabrica-loja/ordens-producao', dados);
    pedido.done(() => {
      opFechar();
      opCarregarLista();
      showNotification('Ordem de produção salva. Nenhum estoque foi movimentado.', 'success');
    }).fail((err) => {
      botao.disabled = false;
      opMostrarErro(opErro(err, 'Não foi possível salvar a ordem.'));
    });
  });

  pagina.addEventListener('change', (evento) => {
    const id = evento.target.id;
    if (id === 'op-filtro-status' || id === 'op-filtro-prioridade' || id === 'op-filtro-inicio' || id === 'op-filtro-fim') {
      opCarregarLista();
    }
  });

  pagina.addEventListener('input', (evento) => {
    const alvo = evento.target;
    if (alvo.id === 'op-filtro-produto') {
      clearTimeout(pagina._opFiltro);
      pagina._opFiltro = setTimeout(opCarregarLista, 250);
      return;
    }
    if (alvo.dataset.campo === 'busca' && alvo.closest('[data-op-linha]')) {
      const linha = alvo.closest('[data-op-linha]');
      const oculto = linha.querySelector('[data-campo="produto_id"]');
      if (oculto) oculto.value = '';
      clearTimeout(linha._opProduto);
      linha._opProduto = setTimeout(() => {
        opBuscarProduto(alvo.value, alvo.parentElement, (produto) => opAplicarProduto(linha, produto));
      }, 250);
    }
  });

  if (filtroInicial) {
    const campo = document.getElementById('op-filtro-status');
    if (campo) campo.value = filtroInicial;
  }
  opCarregarLista();
  if (necessidadeInicial) {
    opCarregarFichas().always(() => {
      opApi('GET', '/fabrica-loja/ordens-producao/cobertura/' + necessidadeInicial).done((resposta) => {
        const cobertura = resposta.cobertura;
        const restantes = (cobertura.itens || []).filter((item) => Number(item.restante) > 0);
        if (!restantes.length) {
          showNotification('Não há quantidade restante para uma nova ordem.', 'error');
          return;
        }
        opCarregarVinculosItens(restantes).done(() => opAbrirFormulario(null, cobertura))
          .fail((err) => showNotification(opErro(err, 'Não foi possível carregar as fichas dos produtos.'), 'error'));
      }).fail((err) => showNotification(opErro(err, 'Não foi possível abrir a necessidade.'), 'error'));
    });
  } else if (abrirInicial) {
    opAbrir(abrirInicial, false);
  } else if (novaInicial) {
    opCarregarFichas().always(() => opAbrirFormulario(null));
  }
}
