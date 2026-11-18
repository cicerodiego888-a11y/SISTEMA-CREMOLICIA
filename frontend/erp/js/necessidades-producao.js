/**
 * Necessidade de produção.
 * Registra o que falta produzir. Não abre ordem de produção e não movimenta a loja.
 */

const NP_ORIGENS = [
  { id: 'PEDIDO_LOJA', nome: 'Pedidos da Loja' },
  { id: 'ABASTECIMENTO', nome: 'Abastecimento interno' },
  { id: 'PLANEJAMENTO', nome: 'Planejamento' },
  { id: 'MANUAL', nome: 'Manual' }
];

function npEsc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function npNomeOrigem(origem) {
  const achada = NP_ORIGENS.find((item) => item.id === origem);
  return achada ? achada.nome : origem;
}

function npNomeStatus(status) {
  const nomes = {
    ABERTA: 'Aberta',
    PARCIALMENTE_ATENDIDA: 'Parcialmente atendida',
    ATENDIDA: 'Atendida',
    CANCELADA: 'Cancelada'
  };
  return nomes[status] || status || 'Aberta';
}

function npClasseStatus(status) {
  if (status === 'PARCIALMENTE_ATENDIDA') return 'text-warning';
  if (status === 'ATENDIDA') return 'text-success';
  if (status === 'CANCELADA') return 'text-muted';
  return 'text-body';
}

function npData(valor) {
  const texto = String(valor || '');
  const data = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (!data) return texto;
  return data[3] + '/' + data[2] + '/' + data[1] + (data[4] ? ' ' + data[4] : '');
}

function npPodeCriar(atual) {
  return !!(atual && atual.pode_criar_op);
}

function npPodeCancelar(atual) {
  return !!(atual && atual.pode_cancelar);
}

function npHtmlBotoes(atual) {
  const criar = npPodeCriar(atual) ? '<button type="button" class="btn btn-outline-primary" id="np-criar-op">Criar Ordem de Produção</button>' : '';
  const cancelar = npPodeCancelar(atual) ? '<button type="button" class="btn btn-outline-warning" id="np-cancelar">Cancelar</button>' : '';
  return criar + cancelar;
}

function npHtmlCiclo(atual) {
  if (!atual || !atual.id) return '';
  const ordens = (atual.ordens_producao || []).map((ordem) => {
    const producao = (ordem.producoes || []).map((item) => `<div>Produção: ${npEsc(item.produzido)} produzidos${Number(item.perdido) > 0 ? ' · ' + npEsc(item.perdido) + ' perdidos' : ''}</div>`).join('');
    return `<div class="np-ciclo-passo">
      <strong>${npEsc(ordem.codigo)}</strong>
      <div>${npEsc(ordem.status)}</div>
      <div>${npEsc(ordem.planejado)} planejados</div>
      <div>${npEsc(ordem.produzido)} produzidos</div>
      ${producao}
    </div>`;
  }).join('<div class="np-ciclo-seta">↓</div>');
  return `<div class="np-ciclo" aria-label="Ciclo da necessidade">
    <div class="np-ciclo-passo"><div class="text-muted small">Origem</div><strong>${npEsc(atual.origem_nome || npNomeOrigem(atual.origem))}</strong></div>
    <div class="np-ciclo-seta">↓</div>
    <div class="np-ciclo-passo"><div class="text-muted small">Necessidade</div><strong>${npEsc(atual.codigo)}</strong></div>
    <div class="np-ciclo-seta">↓</div>
    ${ordens || '<div class="np-ciclo-passo">Nenhuma ordem de produção</div>'}
    <div class="np-ciclo-seta">↓</div>
    <div class="np-ciclo-passo"><div class="text-muted small">Atendimento</div><strong class="${npClasseStatus(atual.status)}">${npEsc(npNomeStatus(atual.status))}</strong></div>
  </div>`;
}

function npHtmlAtendimento(atual) {
  const atendimento = atual && (atual.resumo || atual.atendimento);
  const itens = atual && atual.atendimento && atual.atendimento.itens;
  if (!atual || !atual.id || !atendimento) return '';
  const linhas = (itens || []).map((item) => `<tr>
    <td>${npEsc(item.descricao || 'Produto')}</td>
    <td class="text-end">${npEsc(item.solicitado)}</td>
    <td class="text-end">${npEsc(item.planejado)}</td>
    <td class="text-end">${npEsc(item.produzido)}</td>
    <td class="text-end">${npEsc(item.restante)}</td>
    <td>${npEsc(item.situacao_nome || '')}</td>
  </tr>`).join('');
  return `<div class="ft-bloco mb-3">
    <div class="text-muted small">Necessidade de produção</div>
    <h3 class="h5 mb-1">${npEsc(atual.codigo)}</h3>
    <div>Origem: ${npEsc(atual.origem_nome || npNomeOrigem(atual.origem))}</div>
    <div>Criada em: ${npEsc(npData(atual.created_at) || '—')}</div>
    <div class="mt-2">Status: <strong class="${npClasseStatus(atual.status)}">${npEsc(npNomeStatus(atual.status))}</strong></div>
    ${atual.aviso ? `<div class="mt-2">${npEsc(atual.aviso)}</div>` : ''}
    <div class="row g-2 mt-2">
      <div class="col-6 col-md-3"><div class="text-muted small">Solicitado</div><strong>${npEsc(atendimento.solicitado)}</strong></div>
      <div class="col-6 col-md-3"><div class="text-muted small">Planejado</div><strong>${npEsc(atendimento.planejado)}</strong></div>
      <div class="col-6 col-md-3"><div class="text-muted small">Produzido</div><strong>${npEsc(atendimento.produzido)}</strong></div>
      <div class="col-6 col-md-3"><div class="text-muted small">Restante</div><strong>${npEsc(atendimento.restante)}</strong></div>
    </div>
    <div class="table-responsive mt-3">
      <table class="table table-sm mb-0">
        <thead><tr><th>Produto</th><th class="text-end">Solicitado</th><th class="text-end">Planejado</th><th class="text-end">Produzido</th><th class="text-end">Restante</th><th>Situação</th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="6">—</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
}

function npHtmlComposicao(atual) {
  const grupos = new Map();
  (atual.pedidos || []).forEach((pedido) => {
    (pedido.itens || []).forEach((item) => {
      const grupo = grupos.get(item.produto_id) || { nome: item.produto_nome || 'Produto', linhas: [], total: 0 };
      grupo.linhas.push({ codigo: pedido.codigo || ('Pedido ' + pedido.pedido_id), quantidade: item.quantidade });
      grupo.total += Number(item.quantidade) || 0;
      grupos.set(item.produto_id, grupo);
    });
  });
  if (!grupos.size) return '';
  return [...grupos.values()].map((grupo) => `<div class="mt-2"><strong>${npEsc(grupo.nome)}</strong>
    ${grupo.linhas.map((linha) => `<div>${npEsc(linha.codigo)} → ${npEsc(linha.quantidade)}</div>`).join('')}
    <div>Total → ${npEsc(Math.round(grupo.total * 1000) / 1000)}</div>
  </div>`).join('');
}

function npHtmlOrigem(atual) {
  if (!atual || !atual.id) return '';
  if (atual.origem !== 'PEDIDO_LOJA') {
    return `<div class="ft-bloco mb-3"><h3 class="h6">Origem da demanda</h3><div>${npEsc(atual.origem_nome || npNomeOrigem(atual.origem))}</div></div>`;
  }
  const pedidos = atual.pedidos || [];
  const blocos = pedidos.map((pedido) => {
    const itens = (pedido.itens || []).map((item) => `<div class="ms-3">${npEsc(item.produto_nome || 'Produto')}: ${npEsc(item.quantidade)} ${npEsc(item.unidade)}</div>`).join('');
    const extras = [pedido.data ? npData(pedido.data) : '', pedido.cliente_nome || ''].filter(Boolean).join(' · ');
    return `<div class="mt-2"><strong>${npEsc(pedido.codigo || ('Pedido ' + pedido.pedido_id))}</strong>${extras ? `<div>${npEsc(extras)}</div>` : ''}${itens}</div>`;
  }).join('');
  return `<div class="ft-bloco mb-3">
    <h3 class="h6">Origem da demanda</h3>
    <div>Pedidos da Loja</div>
    ${blocos || '<div>Nenhum pedido vinculado.</div>'}
    ${npHtmlComposicao(atual)}
  </div>`;
}

function npHtmlOrdens(atual) {
  const ordens = (atual && atual.ordens_producao) || [];
  if (!atual || !atual.id) return '';
  const blocos = ordens.map((ordem) => {
    const produtos = (ordem.produtos || []).map((item) => `<div>${npEsc(item.produto_nome || 'Produto')}: ${npEsc(item.planejado)} ${npEsc(item.unidade)}</div>`).join('');
    const producao = (ordem.producoes || []).map((item) => `<div>Produção: ${npEsc(item.produzido)} produzidos${Number(item.perdido) > 0 ? ' · ' + npEsc(item.perdido) + ' perdidos' : ''}</div>`).join('');
    return `<div class="border rounded p-2 mb-2">
      <div class="d-flex justify-content-between gap-2 flex-wrap">
        <strong>${npEsc(ordem.codigo)}</strong>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-np-ver-op="${npEsc(ordem.id)}">Ver OP</button>
      </div>
      <div>Status: ${npEsc(ordem.status)}</div>
      <div>Planejado: ${npEsc(ordem.planejado)}</div>
      <div>Produzido: ${npEsc(ordem.produzido)}</div>
      ${ordem.data ? `<div>Data prevista: ${npEsc(npData(ordem.data))}</div>` : ''}
      ${ordem.criada_em_texto ? `<div>Criada em: ${npEsc(ordem.criada_em_texto)}</div>` : ''}
      <div>Origem: ${npEsc(ordem.origem || '')}</div>
      ${produtos}
      ${producao}
    </div>`;
  }).join('');
  return `<div class="ft-bloco mb-3"><h3 class="h6">Ordens de produção</h3>${blocos || '<div>Nenhuma ordem de produção.</div>'}</div>`;
}

function npHtmlHistorico(atual) {
  const eventos = (atual && atual.historico) || [];
  if (!atual || !atual.id || !eventos.length) return '';
  const linhas = eventos.map((evento) => `<div><span class="text-muted">${npEsc(evento.quando_texto || '—')}</span> ${npEsc(evento.texto)}${evento.detalhe ? ' · ' + npEsc(evento.detalhe) : ''}</div>`).join('');
  return `<div class="ft-bloco mb-3"><h3 class="h6">Linha do tempo</h3>${linhas}</div>`;
}

function npHtmlOperacao(atual) {
  if (!atual || !atual.id) return '';
  return `${npHtmlCiclo(atual)}${npHtmlAtendimento(atual)}${npHtmlOrigem(atual)}${npHtmlOrdens(atual)}${npHtmlHistorico(atual)}`;
}

function npApi(method, caminho, dados) {
  return $.ajax({
    url: API_URL + caminho,
    method: method,
    contentType: 'application/json',
    data: dados ? JSON.stringify(dados) : undefined,
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  });
}

function npErro(err, reserva) {
  const corpo = err && err.responseJSON;
  return (corpo && corpo.error) || reserva;
}

function npHtmlFicha(item, produtoId) {
  const atual = item || {};
  const fichas = (window.npVinculosFichas && window.npVinculosFichas[String(produtoId)]) || [];
  let escolhida = atual.ficha_padrao_vinculo_id
    ? `padrao:${atual.ficha_padrao_vinculo_id}:${atual.ficha_padrao_versao_id || ''}`
    : (atual.ficha_tecnica_id ? `tradicional:${atual.ficha_tecnica_id}` : '');
  if (!escolhida && fichas.length === 1) {
    const unica = fichas[0];
    escolhida = unica.origem === 'TRADICIONAL'
      ? `tradicional:${unica.ficha_tecnica_id}`
      : `padrao:${unica.ficha_padrao_vinculo_id}:${unica.ficha_padrao_versao_id}`;
  }
  const opcoes = ['<option value="">Sem ficha</option>'].concat(fichas.map((ficha) => {
    const tradicional = ficha.origem === 'TRADICIONAL';
    const valor = tradicional
      ? `tradicional:${ficha.ficha_tecnica_id}`
      : `padrao:${ficha.ficha_padrao_vinculo_id}:${ficha.ficha_padrao_versao_id}`;
    const marca = escolhida === valor ? ' selected' : '';
    const origem = tradicional
      ? 'Tradicional'
      : `${ficha.tipo === 'SABOR' ? 'Por sabor' : 'Padrão legado'} · versão ${npEsc(ficha.numero_versao)}`;
    return `<option value="${npEsc(valor)}"${marca}>${npEsc(ficha.codigo)} — ${npEsc(ficha.nome)} · ${origem}</option>`;
  }));
  const fichaCapturadaAtiva = fichas.some((ficha) =>
    Number(ficha.ficha_padrao_vinculo_id) === Number(atual.ficha_padrao_vinculo_id) &&
    Number(ficha.ficha_padrao_versao_id) === Number(atual.ficha_padrao_versao_id)
  );
  if (atual.ficha_padrao_vinculo_id && !fichaCapturadaAtiva) {
    const nome = atual.ficha_padrao_snapshot && atual.ficha_padrao_snapshot.nome;
    const codigo = atual.ficha_padrao_snapshot && atual.ficha_padrao_snapshot.codigo;
    const valor = `padrao:${atual.ficha_padrao_vinculo_id}:${atual.ficha_padrao_versao_id || ''}`;
    const categoria = atual.ficha_padrao_snapshot?.ficha_por_sabor ? 'Ficha por sabor' : 'Ficha padrão legada';
    opcoes.push(`<option value="${npEsc(valor)}" selected>${npEsc(codigo || categoria)} — ${npEsc(nome || 'Vínculo capturado')} · versão capturada</option>`);
    escolhida = valor;
  }
  const fichaTradicionalAtiva = fichas.some((ficha) =>
    ficha.origem === 'TRADICIONAL' &&
    Number(ficha.ficha_tecnica_id) === Number(atual.ficha_tecnica_id)
  );
  if (atual.ficha_tecnica_id && !fichaTradicionalAtiva) {
    const valor = `tradicional:${atual.ficha_tecnica_id}`;
    opcoes.push(`<option value="${npEsc(valor)}"${escolhida === valor ? ' selected' : ''}>Ficha tradicional #${npEsc(atual.ficha_tecnica_id)} (registro legado)</option>`);
  }
  return `<select class="form-select form-select-sm" data-campo="ficha_escolhida">${opcoes.join('')}</select>`;
}

function npColetarFicha(linha) {
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

function npHtmlProdutoSelecionado(item) {
  const codigo = item.codigo ? `Código: ${npEsc(item.codigo)}` : 'Produto cadastrado';
  return `
    <div class="ft-selecionado" data-np-selecionado>
      <div>
        <strong>${npEsc(item.descricao || item.nome || '')}</strong>
        <div class="ft-selecionado-meta">${codigo}</div>
      </div>
      <div class="d-flex align-items-center">
        <button type="button" class="btn btn-link btn-sm p-0 me-1" data-np-alterar>Alterar produto</button>
        <button type="button" class="btn btn-link btn-sm ft-limpar" data-np-limpar aria-label="Remover produto">×</button>
      </div>
    </div>`;
}

function npHtmlBuscaProduto(item) {
  const legado = item && !item.produto_id && item.descricao
    ? `<div class="ft-vinculo">Registro antigo: ${npEsc(item.descricao)}. Selecione um produto cadastrado.</div>`
    : '';
  return `
    <input class="form-control form-control-sm" data-campo="busca" placeholder="Buscar produto..." autocomplete="off">
    ${legado}`;
}

function npHtmlItem(item) {
  const atual = item || {};
  const vinculado = !!atual.produto_id;
  return `
    <div class="ft-linha np-linha-item" data-np-linha="item">
      <div class="ft-busca">
        <label class="form-label mb-1">O que produzir</label>
        ${vinculado ? npHtmlProdutoSelecionado(atual) : npHtmlBuscaProduto(atual)}
        <input type="hidden" data-campo="id" value="${atual.id ? npEsc(atual.id) : ''}">
        <input type="hidden" data-campo="descricao" value="${npEsc(vinculado ? atual.descricao : '')}">
        <input type="hidden" data-campo="produto_id" value="${atual.produto_id ? npEsc(atual.produto_id) : ''}">
      </div>
      <div>
        <label class="form-label mb-1">Quantidade</label>
        <input class="form-control form-control-sm" data-campo="quantidade" value="${atual.quantidade == null ? '' : npEsc(atual.quantidade)}" inputmode="decimal">
      </div>
      <div>
        <label class="form-label mb-1">Unidade</label>
        <input class="form-control form-control-sm" data-campo="unidade" value="${npEsc(atual.unidade)}" placeholder="kg, L, un">
      </div>
      <div>
        <label class="form-label mb-1">Ficha de referência</label>
        ${npHtmlFicha(atual, atual.produto_id)}
      </div>
      <button type="button" class="btn btn-outline-danger btn-sm" data-np-remover>Remover</button>
    </div>`;
}

function npCampo(linha, nome) {
  const campo = linha.querySelector(`[data-campo="${nome}"]`);
  return campo ? campo.value : '';
}

function npPedidosMarcados() {
  return Array.from(document.querySelectorAll('[data-np-pedido]')).filter((bloco) => {
    const marca = bloco.querySelector('.np-marcar-pedido');
    return marca && marca.checked;
  }).map((bloco) => ({
    pedido_id: bloco.getAttribute('data-np-pedido'),
    itens: Array.from(bloco.querySelectorAll('.np-qtd-pedido')).map((campo) => ({
      produto_id: campo.getAttribute('data-produto-id'),
      quantidade: campo.value,
      unidade: campo.getAttribute('data-unidade') || ''
    })).filter((item) => Number(String(item.quantidade).replace(',', '.')) > 0)
  }));
}

function npColetar() {
  const dados = {
    codigo: document.getElementById('np-codigo').value,
    origem: document.getElementById('np-origem').value,
    pedido_id: document.getElementById('np-pedido-id').value,
    referencia: document.getElementById('np-referencia').value,
    descricao: document.getElementById('np-descricao').value,
    data_necessidade: document.getElementById('np-data').value,
    observacoes: document.getElementById('np-observacoes').value,
    status: document.getElementById('np-status').value || 'ABERTA',
    itens: Array.from(document.querySelectorAll('#np-itens [data-np-linha]')).map((linha) => ({
      produto_id: npCampo(linha, 'produto_id'),
      descricao: npCampo(linha, 'descricao'),
      quantidade: npCampo(linha, 'quantidade'),
      unidade: npCampo(linha, 'unidade'),
      id: npCampo(linha, 'id'),
      ...npColetarFicha(linha)
    }))
  };
  if (dados.origem === 'PEDIDO_LOJA') {
    const pedidos = npPedidosMarcados();
    if (pedidos.length) {
      dados.pedidos = pedidos;
      dados.pedido_id = pedidos.length === 1 ? pedidos[0].pedido_id : '';
    }
  }
  return dados;
}

function npMostrarErro(mensagem) {
  const aviso = document.getElementById('np-erro');
  if (!aviso) return;
  aviso.textContent = mensagem;
  aviso.classList.remove('d-none');
}

function npMostrarOpExistente(mensagem, ordem) {
  const erro = document.getElementById('np-erro');
  if (!erro) return;
  const anterior = document.getElementById('np-aviso-op');
  if (anterior) anterior.remove();
  const ver = ordem && ordem.id
    ? ` <button type="button" class="btn btn-outline-secondary btn-sm ms-2" data-np-ver-op="${npEsc(ordem.id)}">Ver ${npEsc(ordem.codigo || 'Ordem de Produção')}</button>`
    : '';
  erro.insertAdjacentHTML('beforebegin', `<div id="np-aviso-op" class="alert alert-info">${npEsc(mensagem || 'Esta necessidade já possui uma Ordem de Produção.')}${ver}</div>`);
}

function npAtualizarOrigem() {
  const origem = document.getElementById('np-origem').value;
  const bloco = document.getElementById('np-bloco-loja');
  if (bloco) bloco.hidden = origem !== 'PEDIDO_LOJA';
  if (origem !== 'PEDIDO_LOJA') {
    document.getElementById('np-pedido-id').value = '';
    document.getElementById('np-referencia').value = '';
    const vinculo = document.getElementById('np-pedido-vinculo');
    if (vinculo) vinculo.textContent = '';
    document.querySelectorAll('.np-marcar-pedido').forEach((campo) => { campo.checked = false; });
    npAtualizarConsolidado();
  } else if (document.getElementById('np-lista-pedidos') && !document.querySelector('[data-np-pedido]')) {
    npCarregarDemanda();
  }
}

function npAbrirEditor(necessidade) {
  const atual = necessidade || {
    id: null,
    codigo: '',
    origem: 'MANUAL',
    pedido_id: null,
    referencia: '',
    descricao: '',
    data_necessidade: '',
    status: 'ABERTA',
    observacoes: '',
    itens: []
  };
  const editor = document.getElementById('np-editor');
  if (!editor) return;
  window.npNecessidadeAtual = atual.id ? atual : null;
  if (npNecessidadeFechada(atual)) {
    editor.hidden = false;
    editor.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
            <h2 class="h5 mb-0">${npEsc(atual.codigo || 'Necessidade')}</h2>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="np-voltar">Voltar</button>
          </div>
          <div id="np-erro" class="alert alert-danger d-none" role="alert"></div>
          <input type="hidden" id="np-id" value="${npEsc(atual.id)}">
          ${npHtmlOperacao(atual)}
        </div>
        <div class="card-footer d-flex gap-2 justify-content-end">${npHtmlBotoes(atual)}</div>
      </div>`;
    document.getElementById('np-lista-painel').hidden = true;
    return;
  }
  const opcoes = NP_ORIGENS.map((origem) => {
    const marca = origem.id === atual.origem ? ' selected' : '';
    return `<option value="${origem.id}"${marca}>${npEsc(origem.nome)}</option>`;
  }).join('');
  editor.hidden = false;
  editor.innerHTML = `
    <form id="np-form" class="card" autocomplete="off">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
          <h2 class="h5 mb-0">${atual.id ? 'Editar necessidade' : 'Nova necessidade'}</h2>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="np-voltar">Voltar</button>
        </div>
        <div id="np-erro" class="alert alert-danger d-none" role="alert"></div>
        ${npHtmlOperacao(atual)}
        <input type="hidden" id="np-id" value="${atual.id ? npEsc(atual.id) : ''}">
        <input type="hidden" id="np-status" value="${npEsc(atual.status || 'ABERTA')}">
        <input type="hidden" id="np-pedido-id" value="${atual.pedido_id ? npEsc(atual.pedido_id) : ''}">
        <div class="row g-2">
          <div class="col-md-3">
            <label class="form-label" for="np-codigo">Código</label>
            <input class="form-control" id="np-codigo" maxlength="40" value="${npEsc(atual.codigo)}" placeholder="Gerado se ficar vazio">
          </div>
          <div class="col-md-5">
            <label class="form-label" for="np-origem">Origem</label>
            <select class="form-select" id="np-origem">${opcoes}</select>
          </div>
          <div class="col-md-4">
            <label class="form-label" for="np-data">Para quando</label>
            <input class="form-control" id="np-data" type="date" value="${npEsc(atual.data_necessidade)}">
          </div>
          <div class="col-12">
            <label class="form-label" for="np-descricao">Descrição *</label>
            <input class="form-control" id="np-descricao" maxlength="200" value="${npEsc(atual.descricao)}" required>
          </div>
          <div class="col-12" id="np-bloco-loja">
            <label class="form-label" for="np-referencia">Pedido ou referência da loja</label>
            <div class="ft-busca">
              <input class="form-control" id="np-referencia" maxlength="160" value="${npEsc(atual.referencia)}" placeholder="Código do pedido ou descrição da necessidade da loja" autocomplete="off">
            </div>
            <div class="d-flex gap-2 align-items-center mt-2 flex-wrap">
              <button type="button" class="btn btn-outline-primary btn-sm" id="np-copiar-itens">Copiar itens do pedido</button>
              <span class="small text-muted" id="np-pedido-vinculo">${atual.pedido_id ? 'Pedido vinculado nº ' + npEsc(atual.pedido_id) : ''}</span>
            </div>
            <div class="mt-3" id="np-selecao">
              <h3 class="h6">Selecionar pedidos</h3>
              <div id="np-lista-pedidos" class="text-muted small">Carregando pedidos...</div>
              <div id="np-consolidado" class="mt-3"></div>
            </div>
          </div>
          <div class="col-12">
            <label class="form-label" for="np-observacoes">Observações</label>
            <textarea class="form-control" id="np-observacoes" rows="2">${npEsc(atual.observacoes)}</textarea>
          </div>
        </div>
        <div class="ft-bloco mt-3">
          <div class="d-flex justify-content-between align-items-center">
            <h3>Itens a produzir</h3>
            <button type="button" class="btn btn-outline-primary btn-sm" id="np-adicionar-item">Adicionar item</button>
          </div>
          <div id="np-itens"></div>
        </div>
      </div>
      <div class="card-footer d-flex gap-2 justify-content-end">
        ${npHtmlBotoes(atual)}
        <button type="submit" class="btn btn-success" id="np-salvar">Salvar necessidade</button>
      </div>
    </form>`;
  const linhas = (atual.itens && atual.itens.length ? atual.itens : [{}]).map(npHtmlItem).join('');
  document.getElementById('np-itens').innerHTML = linhas;
  document.getElementById('np-lista-painel').hidden = true;
  window.npPedidosSalvos = (atual.pedidos || []).filter((pedido) => pedido && !pedido.legado && (pedido.itens || []).length);
  npAtualizarOrigem();
  if (atual.origem === 'PEDIDO_LOJA') npCarregarDemanda();
  document.getElementById('np-descricao').focus();
}

function npNecessidadeFechada(atual) {
  return !!(atual && atual.id && ((atual.ordens_producao || []).length || atual.status === 'ATENDIDA' || atual.status === 'CANCELADA'));
}

function npHtmlPedidoDemanda(pedido, salvo) {
  const marcado = !!salvo;
  const linhas = (pedido.itens || []).map((item) => {
    const gravado = salvo && (salvo.itens || []).find((linha) => String(linha.produto_id) === String(item.produto_id));
    const valor = gravado ? gravado.quantidade : item.quantidade_elegivel;
    return `<div class="d-flex gap-2 align-items-center ms-4 mt-1">
      <span class="flex-grow-1">${npEsc(item.produto_nome || 'Produto')}</span>
      <input class="form-control form-control-sm np-qtd-pedido" type="number" min="0" max="${npEsc(item.quantidade_elegivel)}" step="0.001" style="width:7rem" value="${npEsc(valor)}" data-produto-id="${npEsc(item.produto_id)}" data-produto-nome="${npEsc(item.produto_nome || '')}" data-unidade="${npEsc(item.unidade || '')}" ${marcado ? '' : 'disabled'}>
      <span>${npEsc(item.unidade || '')}</span>
    </div>`;
  }).join('');
  return `<div class="border rounded p-2 mb-2" data-np-pedido="${npEsc(pedido.id)}">
    <div class="form-check">
      <input class="form-check-input np-marcar-pedido" type="checkbox" ${marcado ? 'checked' : ''}>
      <label class="form-check-label">${npEsc(pedido.codigo || ('Pedido ' + pedido.id))} — ${npEsc(pedido.cliente_nome || 'Sem cliente')}</label>
    </div>
    ${linhas}
  </div>`;
}

function npAtualizarConsolidado() {
  const alvo = document.getElementById('np-consolidado');
  if (!alvo) return;
  const grupos = new Map();
  document.querySelectorAll('[data-np-pedido]').forEach((bloco) => {
    const marca = bloco.querySelector('.np-marcar-pedido');
    const ativo = !!(marca && marca.checked);
    bloco.querySelectorAll('.np-qtd-pedido').forEach((campo) => {
      campo.disabled = !ativo;
      if (!ativo) return;
      const maximo = Number(campo.getAttribute('max'));
      const quantidade = Number(String(campo.value).replace(',', '.'));
      if (Number.isFinite(maximo) && quantidade > maximo) campo.value = String(maximo);
      const usada = Number(String(campo.value).replace(',', '.'));
      if (!(usada > 0)) return;
      const id = campo.getAttribute('data-produto-id');
      const grupo = grupos.get(id) || {
        nome: campo.getAttribute('data-produto-nome'),
        unidade: campo.getAttribute('data-unidade'),
        quantidade: 0
      };
      grupo.quantidade += usada;
      grupos.set(id, grupo);
    });
  });
  const marcados = document.querySelectorAll('.np-marcar-pedido:checked').length;
  if (!marcados) {
    alvo.innerHTML = '';
    return;
  }
  const lista = [...grupos.values()];
  alvo.innerHTML = `<div>Pedidos vinculados: ${marcados}</div>
    <h3 class="h6 mt-2">Demanda consolidada</h3>
    <table class="table table-sm mb-0"><thead><tr><th>Produto</th><th class="text-end">Quantidade</th></tr></thead>
    <tbody>${lista.map((item) => `<tr><td>${npEsc(item.nome)}</td><td class="text-end">${npEsc(Math.round(item.quantidade * 1000) / 1000)} ${npEsc(item.unidade)}</td></tr>`).join('') || '<tr><td colspan="2">Informe a quantidade.</td></tr>'}</tbody></table>`;
}

function npCarregarDemanda() {
  const lista = document.getElementById('np-lista-pedidos');
  if (!lista) return;
  const id = document.getElementById('np-id').value;
  npApi('GET', '/fabrica-loja/demanda-pedidos' + (id ? '?necessidade_id=' + encodeURIComponent(id) : '')).done((resposta) => {
    const pedidos = (resposta && resposta.pedidos) || [];
    const salvos = window.npPedidosSalvos || [];
    if (!pedidos.length) {
      lista.innerHTML = '<div>Nenhum pedido da loja disponível.</div><div id="np-orientacao-sem-pedidos">Informe uma referência da necessidade ou altere a origem para Manual.</div>';
      return;
    }
    lista.innerHTML = pedidos.map((pedido) => npHtmlPedidoDemanda(pedido, salvos.find((item) => String(item.pedido_id) === String(pedido.id)))).join('');
    npAtualizarConsolidado();
  }).fail(() => {
    lista.textContent = 'Não foi possível carregar os pedidos da loja.';
  });
}

function npFecharEditor() {
  const editor = document.getElementById('np-editor');
  const lista = document.getElementById('np-lista-painel');
  if (editor) {
    editor.hidden = true;
    editor.innerHTML = '';
  }
  if (lista) lista.hidden = false;
}

function npRenderLista(necessidades) {
  const corpo = document.getElementById('np-tbody');
  if (!corpo) return;
  if (!necessidades.length) {
    corpo.innerHTML = '<tr><td colspan="12" class="text-muted">Nenhuma necessidade de produção cadastrada.</td></tr>';
    return;
  }
  corpo.innerHTML = necessidades.map((item) => `
    <tr>
      <td>${npEsc(item.codigo)}</td>
      <td>${npEsc(item.descricao)}</td>
      <td>${npEsc(npNomeOrigem(item.origem))}</td>
      <td>${npEsc(item.referencia || '—')}</td>
      <td>${item.itens}</td>
      <td>${npEsc(item.data_necessidade || '—')}</td>
      <td class="text-end">${item.solicitado == null ? '—' : npEsc(item.solicitado)}</td>
      <td class="text-end">${item.planejado == null ? '—' : npEsc(item.planejado)}</td>
      <td class="text-end">${item.produzido == null ? '—' : npEsc(item.produzido)}</td>
      <td class="text-end">${item.restante == null ? '—' : npEsc(item.restante)}</td>
      <td class="${npClasseStatus(item.status)}">${npEsc(npNomeStatus(item.status))}</td>
      <td><button type="button" class="btn btn-outline-primary btn-sm" data-np-abrir="${npEsc(item.id)}">Abrir</button></td>
    </tr>
  `).join('');
}

function npCarregarLista() {
  const params = new URLSearchParams();
  const busca = document.getElementById('np-busca');
  const origem = document.getElementById('np-filtro-origem');
  if (busca && busca.value.trim()) params.set('busca', busca.value.trim());
  if (origem && origem.value) params.set('origem', origem.value);
  const situacao = document.getElementById('np-filtro-status');
  if (situacao && situacao.value) params.set('atendimento', situacao.value);
  else params.set('incluir_canceladas', '1');
  const query = params.toString();
  npApi('GET', '/fabrica-loja/necessidades' + (query ? '?' + query : ''))
    .done((resposta) => npRenderLista((resposta && resposta.necessidades) || []))
    .fail((err) => {
      if (typeof showNotification === 'function') {
        showNotification(npErro(err, 'Não foi possível carregar as necessidades.'), 'error');
      }
    });
}

function npCarregarFichas() {
  window.npVinculosFichas = {};
  return $.Deferred().resolve([]).promise();
}

function npCarregarVinculosProduto(produtoId) {
  if (!produtoId) return $.Deferred().resolve([]).promise();
  window.npVinculosFichas = window.npVinculosFichas || {};
  const chave = String(produtoId);
  if (Object.prototype.hasOwnProperty.call(window.npVinculosFichas, chave)) {
    return $.Deferred().resolve(window.npVinculosFichas[chave]).promise();
  }
  return npApi('GET', `/fabrica-loja/fichas/produtos/${encodeURIComponent(produtoId)}/vinculos`)
    .then((resposta) => {
      const fichas = (resposta && resposta.fichas) || [];
      window.npVinculosFichas[chave] = fichas;
      return fichas;
    });
}

function npCarregarVinculosItens(itens) {
  const ids = [...new Set((itens || []).map((item) => item.produto_id).filter(Boolean))];
  return $.when.apply($, ids.map(npCarregarVinculosProduto));
}

function npPosicionarSugestoes(ancora, itens, aoEscolher, opcoes) {
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
      botao.textContent = item.rotulo;
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

function npAplicarProduto(linha, produto) {
  const busca = linha.querySelector('.ft-busca');
  const produtoId = linha.querySelector('[data-campo="produto_id"]');
  const descricao = linha.querySelector('[data-campo="descricao"]');
  if (produtoId) produtoId.value = produto.id || '';
  if (descricao) descricao.value = produto.nome || '';
  const unidade = linha.querySelector('[data-campo="unidade"]');
  if (unidade && !unidade.value && produto.unidade) unidade.value = produto.unidade;
  busca.querySelectorAll('.ft-selecionado, [data-campo="busca"], .ft-vinculo, .ft-sugestoes').forEach((no) => no.remove());
  busca.querySelector('label').insertAdjacentHTML('afterend', npHtmlProdutoSelecionado({
    descricao: produto.nome,
    codigo: produto.codigo
  }));
  const ficha = linha.querySelector('[data-campo="ficha_escolhida"]');
  if (ficha) {
    ficha.disabled = true;
    npCarregarVinculosProduto(produto.id).done(() => {
      ficha.outerHTML = npHtmlFicha({}, produto.id);
    }).fail((err) => {
      ficha.disabled = false;
      npMostrarErro(npErro(err, 'Não foi possível carregar as fichas vinculadas ao produto.'));
    });
  }
}

function npVoltarBusca(linha) {
  const busca = linha.querySelector('.ft-busca');
  const produtoId = linha.querySelector('[data-campo="produto_id"]');
  const descricao = linha.querySelector('[data-campo="descricao"]');
  if (produtoId) produtoId.value = '';
  if (descricao) descricao.value = '';
  busca.querySelectorAll('.ft-selecionado, [data-campo="busca"], .ft-vinculo, .ft-sugestoes').forEach((no) => no.remove());
  busca.querySelector('label').insertAdjacentHTML('afterend', npHtmlBuscaProduto({}));
  const ficha = linha.querySelector('[data-campo="ficha_escolhida"]');
  if (ficha) ficha.outerHTML = npHtmlFicha({}, '');
  const campo = busca.querySelector('[data-campo="busca"]');
  if (campo) campo.focus();
}

function npBuscarProduto(termo, ancora, aoEscolher) {
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
    npPosicionarSugestoes(ancora, produtos.slice(0, 8).map((produto) => ({ produto })), (item) => aoEscolher(item.produto), { vazio: true });
  });
}

function npBuscarPedido(termo, ancora) {
  const q = String(termo || '').trim().toLowerCase();
  if (q.length < 2) {
    const antiga = ancora.querySelector('.ft-sugestoes');
    if (antiga) antiga.remove();
    return;
  }
  const aplicar = (pedidos) => {
    const filtrados = pedidos.filter((pedido) => {
      const texto = `${pedido.codigo || ''} ${pedido.cliente_nome || ''}`.toLowerCase();
      return texto.indexOf(q) >= 0;
    }).slice(0, 8);
    npPosicionarSugestoes(ancora, filtrados.map((pedido) => ({
      rotulo: `${pedido.codigo || ('Pedido ' + pedido.id)}${pedido.cliente_nome ? ' — ' + pedido.cliente_nome : ''}`,
      pedido
    })), (item) => {
      const pedido = item.pedido;
      document.getElementById('np-pedido-id').value = pedido.id;
      document.getElementById('np-referencia').value = pedido.codigo || '';
      document.getElementById('np-pedido-vinculo').textContent = 'Pedido vinculado nº ' + pedido.id + '. A loja não é alterada.';
      const descricao = document.getElementById('np-descricao');
      if (descricao && !descricao.value.trim()) {
        descricao.value = 'Produzir para ' + (pedido.codigo || 'a loja');
      }
    });
  };
  if (window.npPedidos) {
    aplicar(window.npPedidos);
    return;
  }
  npApi('GET', '/pedidos').done((resposta) => {
    window.npPedidos = Array.isArray(resposta) ? resposta : [];
    aplicar(window.npPedidos);
  });
}

function npCopiarItensPedido() {
  const pedidoId = document.getElementById('np-pedido-id').value;
  if (!pedidoId) {
    npMostrarErro('Selecione um pedido da loja para copiar os itens.');
    return;
  }
  npApi('GET', '/pedidos/' + pedidoId).done((pedido) => {
    const itens = (pedido && pedido.itens) || [];
    if (!itens.length) {
      npMostrarErro('Esse pedido não tem itens para copiar.');
      return;
    }
    npCarregarVinculosItens(itens).done(() => {
      document.getElementById('np-itens').innerHTML = itens.map((item) => npHtmlItem({
      produto_id: item.produto_id,
      descricao: item.produto_nome || item.descricao || '',
      quantidade: item.quantidade,
      unidade: item.produto_unidade || ''
      })).join('');
    }).fail((err) => npMostrarErro(npErro(err, 'Não foi possível carregar as fichas vinculadas aos produtos do pedido.')));
    const aviso = document.getElementById('np-erro');
    if (aviso) aviso.classList.add('d-none');
  }).fail((err) => {
    npMostrarErro(npErro(err, 'Não foi possível ler o pedido da loja.'));
  });
}

function loadNecessidadesProducao() {
  window.npFichas = null;
  window.npPedidos = null;
  const filtroInicial = window._npFiltroAtendimento;
  const abrirInicial = window._npAbrirId;
  const novaInicial = window._npNova;
  window._npFiltroAtendimento = null;
  window._npAbrirId = null;
  window._npNova = null;
  $('#page-content').html(`
    <div class="container mt-4 ft-pagina">
      <div id="np-lista-painel">
        <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
          <div>
            <h2 class="mb-1">Necessidade de Produção</h2>
            <p class="ft-aviso mb-0">Registra o que a fábrica precisa produzir. Não é uma ordem de produção e não significa que a produção foi feita.</p>
          </div>
          <button type="button" class="btn btn-success" id="np-nova">Nova necessidade</button>
        </div>
        <div class="d-flex gap-3 align-items-end flex-wrap mb-3">
          <div>
            <label class="form-label mb-1" for="np-busca">Buscar</label>
            <input class="form-control" id="np-busca" placeholder="Código, descrição ou referência" autocomplete="off">
          </div>
          <div>
            <label class="form-label mb-1" for="np-filtro-origem">Origem</label>
            <select class="form-select" id="np-filtro-origem">
              <option value="">Todas</option>
              ${NP_ORIGENS.map((origem) => `<option value="${origem.id}">${npEsc(origem.nome)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label mb-1" for="np-filtro-status">Situação</label>
            <select class="form-select" id="np-filtro-status">
              <option value="">Todas</option>
              <option value="ABERTA">Abertas</option>
              <option value="PARCIALMENTE_ATENDIDA">Parcialmente atendidas</option>
              <option value="ATENDIDA">Atendidas</option>
              <option value="CANCELADA">Canceladas</option>
            </select>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-bordered table-hover align-middle">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Origem</th>
                <th>Referência</th>
                <th>Itens</th>
                <th>Para quando</th>
                <th class="text-end">Solicitado</th>
                <th class="text-end">Planejado</th>
                <th class="text-end">Produzido</th>
                <th class="text-end">Restante</th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="np-tbody">
              <tr><td colspan="12" class="text-muted">Carregando...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div id="np-editor" hidden></div>
    </div>
  `);

  const pagina = document.querySelector('.ft-pagina');
  pagina.addEventListener('click', (evento) => {
    const alvo = (evento.target.closest && evento.target.closest('button')) || evento.target;
    if (alvo.id === 'np-nova') {
      npCarregarFichas().always(() => npAbrirEditor(null));
      return;
    }
    if (alvo.id === 'np-voltar') {
      npFecharEditor();
      return;
    }
    if (alvo.closest('[data-np-limpar]') || alvo.closest('[data-np-alterar]')) {
      const linha = alvo.closest('[data-np-linha]');
      if (linha) npVoltarBusca(linha);
      return;
    }
    if (alvo.id === 'np-adicionar-item') {
      document.getElementById('np-itens').insertAdjacentHTML('beforeend', npHtmlItem({}));
      return;
    }
    if (alvo.id === 'np-copiar-itens') {
      npCopiarItensPedido();
      return;
    }
    const abrir = alvo.closest('[data-np-abrir]');
    if (abrir) {
      npCarregarFichas().always(() => {
        npApi('GET', '/fabrica-loja/necessidades/' + abrir.getAttribute('data-np-abrir'))
          .done((resposta) => {
            npCarregarVinculosItens(resposta.necessidade.itens).done(() => npAbrirEditor(resposta.necessidade))
              .fail((err) => showNotification(npErro(err, 'Não foi possível carregar as fichas dos produtos.'), 'error'));
          })
          .fail((err) => showNotification(npErro(err, 'Não foi possível abrir a necessidade.'), 'error'));
      });
      return;
    }
    if (alvo.closest('[data-np-remover]')) {
      const linha = alvo.closest('[data-np-linha]');
      const grupo = linha && linha.parentElement;
      if (linha) linha.remove();
      if (grupo && !grupo.querySelector('[data-np-linha]')) {
        grupo.insertAdjacentHTML('beforeend', npHtmlItem({}));
      }
      return;
    }
    const verOp = alvo.getAttribute && alvo.getAttribute('data-np-ver-op');
    if (verOp) {
      window._opAbrirId = verOp;
      if (typeof loadPage === 'function') loadPage('ordens-producao');
      return;
    }
    if (alvo.id === 'np-criar-op') {
      const id = document.getElementById('np-id').value;
      if (!id || alvo.disabled) return;
      alvo.disabled = true;
      npApi('POST', '/fabrica-loja/necessidades/' + id + '/ordem-producao')
        .done((resposta) => {
          const criada = !!(resposta && resposta.criada);
          const ordem = resposta && resposta.ordem;
          npApi('GET', '/fabrica-loja/necessidades/' + id).done((detalhe) => {
            npCarregarVinculosItens(detalhe.necessidade.itens).done(() => npAbrirEditor(detalhe.necessidade));
            if (!criada) npMostrarOpExistente(resposta.mensagem, ordem);
          });
          if (criada) showNotification('Ordem de Produção criada.', 'success');
        })
        .fail((err) => {
          alvo.disabled = false;
          npMostrarErro(npErro(err, 'Não foi possível criar a Ordem de Produção.'));
        });
      return;
    }
    if (alvo.id === 'np-cancelar') {
      if (!window.confirm('Cancelar esta necessidade? Isso não produz e não altera a loja.')) return;
      const id = document.getElementById('np-id').value;
      const guardada = window.npNecessidadeAtual;
      const dados = document.getElementById('np-codigo') ? npColetar() : {
        codigo: guardada.codigo,
        origem: guardada.origem,
        pedido_id: guardada.pedido_id || '',
        referencia: guardada.referencia || '',
        descricao: guardada.descricao,
        data_necessidade: guardada.data_necessidade || '',
        observacoes: guardada.observacoes || '',
        itens: (guardada.itens || []).map((item) => ({
          id: item.id,
          produto_id: item.produto_id,
          descricao: item.descricao,
          quantidade: item.quantidade,
          unidade: item.unidade,
          ficha_tecnica_id: item.ficha_tecnica_id,
          ficha_padrao_vinculo_id: item.ficha_padrao_vinculo_id,
          ficha_padrao_versao_id: item.ficha_padrao_versao_id
        }))
      };
      dados.status = 'CANCELADA';
      alvo.disabled = true;
      npApi('PUT', '/fabrica-loja/necessidades/' + id, dados)
        .done(() => {
          npFecharEditor();
          npCarregarLista();
          showNotification('Necessidade cancelada.', 'success');
        })
        .fail((err) => {
          alvo.disabled = false;
          npMostrarErro(npErro(err, 'Não foi possível cancelar a necessidade.'));
        });
    }
  });

  pagina.addEventListener('submit', (evento) => {
    if (!evento.target || evento.target.id !== 'np-form') return;
    evento.preventDefault();
    const botao = document.getElementById('np-salvar');
    const id = document.getElementById('np-id').value;
    const dados = npColetar();
    const semProduto = Array.from(document.querySelectorAll('#np-itens [data-np-linha]')).some((linha) => {
      const item = {
        produto_id: npCampo(linha, 'produto_id'),
        descricao: npCampo(linha, 'descricao'),
        quantidade: npCampo(linha, 'quantidade'),
        unidade: npCampo(linha, 'unidade'),
        ...npColetarFicha(linha)
      };
      const busca = linha.querySelector('[data-campo="busca"]');
      const digitou = busca && String(busca.value || '').trim();
      const preenchido = String(item.descricao || '').trim() || String(item.quantidade || '').trim() || String(item.unidade || '').trim() || item.ficha_tecnica_id || item.ficha_padrao_vinculo_id || digitou;
      return preenchido && !item.produto_id;
    });
    if (semProduto) {
      botao.disabled = false;
      npMostrarErro('Selecione um produto cadastrado para o item da necessidade.');
      return;
    }
    const lojaSemVinculo = dados.origem === 'PEDIDO_LOJA'
      && !String(dados.pedido_id || '').trim()
      && !(dados.pedidos && dados.pedidos.length)
      && !String(dados.referencia || '').trim();
    if (lojaSemVinculo) {
      botao.disabled = false;
      npMostrarErro('Informe o pedido ou a necessidade da loja.');
      return;
    }
    botao.disabled = true;
    const pedido = id
      ? npApi('PUT', '/fabrica-loja/necessidades/' + id, dados)
      : npApi('POST', '/fabrica-loja/necessidades', dados);
    pedido.done(() => {
      npFecharEditor();
      npCarregarLista();
      showNotification('Necessidade de produção salva.', 'success');
    }).fail((err) => {
      botao.disabled = false;
      npMostrarErro(npErro(err, 'Não foi possível salvar a necessidade.'));
    });
  });

  pagina.addEventListener('change', (evento) => {
    if (evento.target.id === 'np-origem') npAtualizarOrigem();
    if (evento.target.classList && (evento.target.classList.contains('np-marcar-pedido') || evento.target.classList.contains('np-qtd-pedido'))) {
      npAtualizarConsolidado();
    }
    if (evento.target.id === 'np-filtro-origem' || evento.target.id === 'np-filtro-status') npCarregarLista();
  });

  pagina.addEventListener('input', (evento) => {
    const alvo = evento.target;
    if (alvo.id === 'np-busca') {
      clearTimeout(pagina._npBusca);
      pagina._npBusca = setTimeout(npCarregarLista, 250);
      return;
    }
    if (alvo.id === 'np-referencia') {
      document.getElementById('np-pedido-id').value = '';
      const vinculo = document.getElementById('np-pedido-vinculo');
      if (vinculo) vinculo.textContent = '';
      clearTimeout(pagina._npPedido);
      pagina._npPedido = setTimeout(() => npBuscarPedido(alvo.value, alvo.parentElement), 250);
      return;
    }
    if (alvo.dataset.campo === 'busca' && alvo.closest('[data-np-linha]')) {
      const linha = alvo.closest('[data-np-linha]');
      const oculto = linha.querySelector('[data-campo="produto_id"]');
      const descricao = linha.querySelector('[data-campo="descricao"]');
      if (oculto) oculto.value = '';
      if (descricao) descricao.value = '';
      clearTimeout(linha._npProduto);
      linha._npProduto = setTimeout(() => {
        npBuscarProduto(alvo.value, alvo.parentElement, (produto) => npAplicarProduto(linha, produto));
      }, 250);
    }
  });

  if (filtroInicial) {
    const campo = document.getElementById('np-filtro-status');
    if (campo) campo.value = filtroInicial;
  }
  npCarregarLista();
  if (abrirInicial) {
    npCarregarFichas().always(() => {
      npApi('GET', '/fabrica-loja/necessidades/' + abrirInicial)
        .done((resposta) => {
          npCarregarVinculosItens(resposta.necessidade.itens).done(() => npAbrirEditor(resposta.necessidade))
            .fail((err) => showNotification(npErro(err, 'Não foi possível carregar as fichas dos produtos.'), 'error'));
        })
        .fail((err) => showNotification(npErro(err, 'Não foi possível abrir a necessidade.'), 'error'));
    });
  } else if (novaInicial) {
    npCarregarFichas().always(() => npAbrirEditor(null));
  }
}
