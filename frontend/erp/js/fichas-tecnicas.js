/**
 * Fichas técnicas da fábrica.
 * A tela só grava a definição. Não movimenta estoque, produção nem a loja.
 */

function ftEsc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ftApi(method, caminho, dados) {
  return $.ajax({
    url: API_URL + caminho,
    method: method,
    contentType: 'application/json',
    data: dados ? JSON.stringify(dados) : undefined,
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  });
}

function ftErro(err, reserva) {
  const corpo = err && err.responseJSON;
  return (corpo && corpo.error) || reserva;
}

function ftHtmlInsumoSelecionado(item) {
  const codigo = item.codigo ? ` · Código ${ftEsc(item.codigo)}` : '';
  const inativo = item.produto_ativo === false ? ' INATIVO' : '';
  return `
    <div class="ft-selecionado">
      <div>
        <strong>${ftEsc(item.descricao || item.nome || '')}</strong>
        <div class="ft-selecionado-meta">INSUMO${inativo}${codigo}</div>
      </div>
      <button type="button" class="btn btn-link btn-sm ft-limpar" data-ft-limpar aria-label="Trocar insumo">×</button>
    </div>`;
}

function ftHtmlBuscaInsumo(item) {
  const legado = item.texto_legado || (!item.produto_id && item.descricao ? item.descricao : '');
  const avisoLegado = legado
    ? `<div class="ft-vinculo">Texto antigo: ${ftEsc(legado)}. Vincule a um insumo cadastrado.</div>`
    : '';
  const sugestao = item.sugestao_produto_id
    ? `<button type="button" class="btn btn-link btn-sm p-0 ft-vinculo" data-ft-sugerir data-id="${ftEsc(item.sugestao_produto_id)}" data-nome="${ftEsc(item.sugestao_nome)}" data-codigo="${ftEsc(item.sugestao_codigo || '')}" data-unidade="${ftEsc(item.sugestao_unidade || '')}">Encontramos um insumo com este nome. Deseja vincular?</button>`
    : '';
  return `
    <input class="form-control form-control-sm" data-campo="busca" placeholder="Buscar insumo..." autocomplete="off">
    ${avisoLegado}
    ${sugestao}`;
}

function ftHtmlLinhaComponente(item) {
  const atual = item || {};
  const vinculado = !!atual.produto_id;
  const legado = atual.texto_legado || (!vinculado ? (atual.descricao || '') : '');
  return `
    <div class="ft-linha ft-linha-componente" data-ft-linha="componente" data-legado="${ftEsc(legado)}">
      <div class="ft-busca">
        <label class="form-label mb-1">Componente</label>
        <small class="ft-sabor-origem-item" data-ft-origem-label hidden></small>
        ${vinculado ? ftHtmlInsumoSelecionado(atual) : ftHtmlBuscaInsumo(atual)}
        <input type="hidden" data-campo="descricao" value="${ftEsc(vinculado ? atual.descricao : legado)}">
        <input type="hidden" data-campo="produto_id" value="${atual.produto_id ? ftEsc(atual.produto_id) : ''}">
      </div>
      <div>
        <label class="form-label mb-1">Quantidade</label>
        <input class="form-control form-control-sm" data-campo="quantidade" value="${atual.quantidade == null ? '' : ftEsc(atual.quantidade)}" inputmode="decimal">
      </div>
      <div>
        <label class="form-label mb-1">Unidade</label>
        <input class="form-control form-control-sm" data-campo="unidade" value="${ftEsc(atual.unidade)}" placeholder="kg, L, un">
      </div>
      <div>
        <label class="form-label mb-1">Observação</label>
        <input class="form-control form-control-sm" data-campo="observacao" value="${ftEsc(atual.observacao)}">
      </div>
      <button type="button" class="btn btn-outline-danger btn-sm" data-ft-remover>Remover</button>
    </div>`;
}

function ftHtmlLinhaEtapa(item) {
  const atual = item || {};
  return `
    <div class="ft-linha ft-linha-etapa" data-ft-linha="etapa">
      <div>
        <label class="form-label mb-1">Etapa</label>
        <small class="ft-sabor-origem-item" data-ft-origem-label hidden></small>
        <input class="form-control form-control-sm" data-campo="titulo" value="${ftEsc(atual.titulo)}">
      </div>
      <div>
        <label class="form-label mb-1">Como fazer</label>
        <input class="form-control form-control-sm" data-campo="descricao" value="${ftEsc(atual.descricao)}">
      </div>
      <div>
        <label class="form-label mb-1">Tempo (min)</label>
        <input class="form-control form-control-sm" data-campo="tempo_minutos" value="${atual.tempo_minutos == null ? '' : ftEsc(atual.tempo_minutos)}" inputmode="decimal">
      </div>
      <div>
        <label class="form-label mb-1">Observação</label>
        <input class="form-control form-control-sm" data-campo="observacao" value="${ftEsc(atual.observacao)}">
      </div>
      <button type="button" class="btn btn-outline-danger btn-sm" data-ft-remover>Remover</button>
    </div>`;
}

function ftHtmlLinhaInformacao(item) {
  const atual = item || {};
  return `
    <div class="ft-linha ft-linha-info" data-ft-linha="informacao">
      <div>
        <label class="form-label mb-1">Informação</label>
        <small class="ft-sabor-origem-item" data-ft-origem-label hidden></small>
        <input class="form-control form-control-sm" data-campo="titulo" value="${ftEsc(atual.titulo)}" placeholder="Ex.: Validade, temperatura">
      </div>
      <div>
        <label class="form-label mb-1">Descrição</label>
        <input class="form-control form-control-sm" data-campo="valor" value="${ftEsc(atual.valor)}">
      </div>
      <button type="button" class="btn btn-outline-danger btn-sm" data-ft-remover>Remover</button>
    </div>`;
}

function ftPreencherLista(seletor, itens, html) {
  const destino = document.querySelector(seletor);
  if (!destino) return;
  const linhas = (itens && itens.length ? itens : [{}]).map(html).join('');
  destino.innerHTML = linhas;
}

function ftAbrirEditor(ficha) {
  const atual = ficha || {
    id: null,
    codigo: '',
    nome: '',
    rendimento_quantidade: null,
    rendimento_unidade: '',
    observacoes: '',
    ativa: true,
    componentes: [],
    etapas: [],
    informacoes: []
  };
  const editor = document.getElementById('ft-editor');
  if (!editor) return;
  editor.hidden = false;
  editor.innerHTML = `
    <form id="ft-form" class="card" autocomplete="off">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
          <h2 class="h5 mb-0">${atual.id ? 'Editar ficha técnica' : 'Nova ficha técnica'}</h2>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="ft-cancelar">Voltar</button>
        </div>
        <div id="ft-erro" class="alert alert-danger d-none" role="alert"></div>
        <input type="hidden" id="ft-id" value="${atual.id ? ftEsc(atual.id) : ''}">
        <div class="row g-2">
          <div class="col-md-3">
            <label class="form-label" for="ft-codigo">Código</label>
            <input class="form-control" id="ft-codigo" maxlength="40" value="${ftEsc(atual.codigo)}" placeholder="Gerado se ficar vazio">
          </div>
          <div class="col-md-6">
            <label class="form-label" for="ft-nome">Nome da ficha *</label>
            <input class="form-control" id="ft-nome" maxlength="160" value="${ftEsc(atual.nome)}" required>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" id="ft-ativa" ${atual.ativa ? 'checked' : ''}>
              <label class="form-check-label" for="ft-ativa">Ativa</label>
            </div>
          </div>
          <div class="col-md-3">
            <label class="form-label" for="ft-rendimento-qtd">Rendimento</label>
            <input class="form-control" id="ft-rendimento-qtd" value="${atual.rendimento_quantidade == null ? '' : ftEsc(atual.rendimento_quantidade)}" inputmode="decimal">
          </div>
          <div class="col-md-3">
            <label class="form-label" for="ft-rendimento-un">Unidade do rendimento</label>
            <input class="form-control" id="ft-rendimento-un" value="${ftEsc(atual.rendimento_unidade)}" placeholder="kg, L, un">
          </div>
          <div class="col-12">
            <label class="form-label" for="ft-observacoes">Observações</label>
            <textarea class="form-control" id="ft-observacoes" rows="2">${ftEsc(atual.observacoes)}</textarea>
          </div>
        </div>
        <div class="ft-bloco mt-3">
          <div class="d-flex justify-content-between align-items-center">
            <h3>Componentes</h3>
            <button type="button" class="btn btn-outline-primary btn-sm" data-ft-adicionar="componente">Adicionar componente</button>
          </div>
          <p class="ft-aviso mb-2">Busque um insumo cadastrado. O nome usado é o do cadastro de produtos.</p>
          <div id="ft-componentes"></div>
        </div>
        <div class="ft-bloco">
          <div class="d-flex justify-content-between align-items-center">
            <h3>Etapas</h3>
            <button type="button" class="btn btn-outline-primary btn-sm" data-ft-adicionar="etapa">Adicionar etapa</button>
          </div>
          <div id="ft-etapas"></div>
        </div>
        <div class="ft-bloco">
          <div class="d-flex justify-content-between align-items-center">
            <h3>Informações</h3>
            <button type="button" class="btn btn-outline-primary btn-sm" data-ft-adicionar="informacao">Adicionar informação</button>
          </div>
          <div id="ft-informacoes"></div>
        </div>
      </div>
      <div class="card-footer d-flex gap-2 justify-content-end">
        ${atual.id ? '<button type="button" class="btn btn-outline-warning" id="ft-inativar">Inativar</button>' : ''}
        <button type="submit" class="btn btn-success" id="ft-salvar">Salvar ficha</button>
      </div>
    </form>`;
  ftPreencherLista('#ft-componentes', atual.componentes, ftHtmlLinhaComponente);
  ftPreencherLista('#ft-etapas', atual.etapas, ftHtmlLinhaEtapa);
  ftPreencherLista('#ft-informacoes', atual.informacoes, ftHtmlLinhaInformacao);
  document.getElementById('ft-lista-painel').hidden = true;
  document.getElementById('ft-nome').focus();
}

function ftFecharEditor() {
  const editor = document.getElementById('ft-editor');
  const lista = document.getElementById('ft-lista-painel');
  if (editor) {
    editor.hidden = true;
    editor.innerHTML = '';
  }
  if (lista) lista.hidden = false;
}

function ftCampo(linha, nome) {
  const campo = linha.querySelector(`[data-campo="${nome}"]`);
  return campo ? campo.value : '';
}

function ftColetar() {
  function linhas(seletor, montar) {
    return Array.from(document.querySelectorAll(seletor)).map(montar);
  }
  return {
    codigo: document.getElementById('ft-codigo').value,
    nome: document.getElementById('ft-nome').value,
    rendimento_quantidade: document.getElementById('ft-rendimento-qtd').value,
    rendimento_unidade: document.getElementById('ft-rendimento-un').value,
    observacoes: document.getElementById('ft-observacoes').value,
    ativa: document.getElementById('ft-ativa').checked,
    componentes: linhas('#ft-componentes [data-ft-linha]', (linha) => ({
      produto_id: ftCampo(linha, 'produto_id'),
      descricao: ftCampo(linha, 'descricao') || ftCampo(linha, 'busca'),
      quantidade: ftCampo(linha, 'quantidade'),
      unidade: ftCampo(linha, 'unidade'),
      observacao: ftCampo(linha, 'observacao')
    })),
    etapas: linhas('#ft-etapas [data-ft-linha]', (linha) => ({
      titulo: ftCampo(linha, 'titulo'),
      descricao: ftCampo(linha, 'descricao'),
      tempo_minutos: ftCampo(linha, 'tempo_minutos')
    })),
    informacoes: linhas('#ft-informacoes [data-ft-linha]', (linha) => ({
      titulo: ftCampo(linha, 'titulo'),
      valor: ftCampo(linha, 'valor')
    }))
  };
}

function ftMostrarErro(mensagem) {
  const aviso = document.getElementById('ft-erro');
  if (!aviso) return;
  aviso.textContent = mensagem;
  aviso.classList.remove('d-none');
}

function ftRenderLista(fichas) {
  const corpo = document.getElementById('ft-tbody');
  if (!corpo) return;
  if (!fichas.length) {
    corpo.innerHTML = '<tr><td colspan="7" class="text-muted">Nenhuma ficha técnica cadastrada.</td></tr>';
    return;
  }
  corpo.innerHTML = fichas.map((ficha) => `
    <tr>
      <td>${ftEsc(ficha.codigo)}</td>
      <td>${ftEsc(ficha.nome)}</td>
      <td>${ficha.componentes}</td>
      <td>${ficha.etapas}</td>
      <td>${ficha.informacoes}</td>
      <td>${ficha.ativa ? 'Ativa' : 'Inativa'}</td>
      <td class="text-nowrap">
        <button type="button" class="btn btn-outline-primary btn-sm" data-ft-abrir="${ftEsc(ficha.id)}">Abrir</button>
        <button type="button" class="btn btn-outline-warning btn-sm" data-ft-status="${ftEsc(ficha.id)}" data-ativa="${ficha.ativa ? '1' : '0'}">${ficha.ativa ? 'Inativar' : 'Ativar'}</button>
        <button type="button" class="btn btn-outline-danger btn-sm" data-ft-excluir="${ftEsc(ficha.id)}" ${ficha.produto_id != null ? 'disabled title="Desvincule a ficha do produto antes de excluí-la."' : ''}>Excluir</button>
      </td>
    </tr>
  `).join('');
}

function ftCarregarLista() {
  const busca = document.getElementById('ft-busca');
  const inativas = document.getElementById('ft-incluir-inativas');
  const params = new URLSearchParams();
  if (busca && busca.value.trim()) params.set('busca', busca.value.trim());
  if (inativas && inativas.checked) params.set('incluir_inativas', '1');
  const query = params.toString();
  ftApi('GET', '/fabrica-loja/fichas' + (query ? '?' + query : ''))
    .done((resposta) => ftRenderLista((resposta && resposta.fichas) || []))
    .fail((err) => {
      if (typeof showNotification === 'function') {
        showNotification(ftErro(err, 'Não foi possível carregar as fichas técnicas.'), 'error');
      }
    });
}

function ftFecharSugestoesForaDe(alvo) {
  let fechou = false;
  document.querySelectorAll('.ft-sugestoes').forEach((lista) => {
    const ancora = lista.parentElement;
    if (alvo && ancora && ancora.contains(alvo)) return;
    lista.remove();
    fechou = true;
  });
  return fechou;
}

if (!document.documentElement.dataset.ftSugestoesFechamento) {
  document.documentElement.dataset.ftSugestoesFechamento = '1';
  document.addEventListener('pointerdown', (evento) => ftFecharSugestoesForaDe(evento.target));
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && ftFecharSugestoesForaDe(null)) evento.preventDefault();
  });
}

function ftPosicionarSugestoes(ancora, produtos, aoEscolher, modo) {
  const antiga = ancora.querySelector('.ft-sugestoes');
  if (antiga) antiga.remove();
  if (!produtos.length) return;
  const lista = document.createElement('ul');
  lista.className = 'ft-sugestoes';
  produtos.forEach((produto) => {
    const item = document.createElement('li');
    const botao = document.createElement('button');
    botao.type = 'button';
    if (modo === 'insumo' || modo === 'produzido') {
      const nome = document.createElement('span');
      nome.className = 'ft-sugestao-nome';
      nome.textContent = produto.nome || '';
      const meta = document.createElement('span');
      meta.className = 'ft-sugestao-meta';
      meta.textContent = `${modo === 'insumo' ? 'INSUMO' : 'PRODUZIDO'} · Código: ${produto.codigo || '—'}`;
      botao.append(nome, meta);
    } else {
      botao.textContent = `${produto.codigo ? produto.codigo + ' — ' : ''}${produto.nome || ''}`;
    }
    botao.addEventListener('click', () => {
      aoEscolher(produto);
      lista.remove();
    });
    item.appendChild(botao);
    lista.appendChild(item);
  });
  ancora.appendChild(lista);
}

function ftAplicarInsumo(linha, produto) {
  const busca = linha.querySelector('.ft-busca');
  const produtoId = linha.querySelector('[data-campo="produto_id"]');
  const descricao = linha.querySelector('[data-campo="descricao"]');
  if (produtoId) produtoId.value = produto.id || '';
  if (descricao) descricao.value = produto.nome || '';
  const unidade = linha.querySelector('[data-campo="unidade"]');
  if (unidade && !unidade.value && produto.unidade) unidade.value = produto.unidade;
  busca.querySelectorAll('.ft-selecionado, [data-campo="busca"], .ft-vinculo, .ft-sugestoes').forEach((no) => no.remove());
  busca.insertAdjacentHTML('beforeend', ftHtmlInsumoSelecionado({
    descricao: produto.nome,
    codigo: produto.codigo,
    produto_ativo: true
  }));
}

function ftBuscarInsumo(termo, ancora, aoEscolher) {
  const q = String(termo || '').trim();
  if (q.length < 2) {
    const antiga = ancora.querySelector('.ft-sugestoes');
    if (antiga) antiga.remove();
    return;
  }
  ftApi('GET', '/fabrica-loja/insumos?q=' + encodeURIComponent(q)).done((resposta) => {
    const insumos = (resposta && resposta.insumos) || [];
    ftPosicionarSugestoes(ancora, insumos.slice(0, 8), aoEscolher, 'insumo');
  }).fail((err) => ftPadraoMostrarErroBusca(err, 'Não foi possível buscar insumos.'));
}

function ftPadraoMensagemErro(err, reserva) {
  const corpo = err && err.responseJSON;
  if (corpo && corpo.error) return corpo.error;
  if (corpo && corpo.codigo === 'UNIDADE_NAO_COMPROVADA') {
    return 'A unidade não pôde ser comprovada pelo conversor oficial.';
  }
  const mensagens = {
    400: 'Os dados enviados são inválidos.',
    401: 'Sua sessão expirou. Entre novamente para continuar.',
    403: 'Você não tem autorização para esta operação.',
    404: 'O registro solicitado não foi encontrado.',
    409: 'A operação conflita com o estado atual. Atualize os dados e tente novamente.',
    422: 'A composição ou a unidade não passou pela validação do servidor.'
  };
  return mensagens[err && err.status] || reserva || 'Falha de comunicação com o servidor.';
}

function ftPadraoMostrarErroBusca(err, reserva) {
  const mensagem = ftPadraoMensagemErro(err, reserva);
  const avisoPadrao = document.getElementById('ft-padrao-erro');
  const areaPadrao = document.getElementById('ft-area-padrao');
  if (avisoPadrao && areaPadrao && !areaPadrao.hidden) {
    avisoPadrao.hidden = false;
    avisoPadrao.textContent = mensagem;
  } else if (document.getElementById('ft-erro')) {
    ftMostrarErro(mensagem);
  } else if (typeof showNotification === 'function') {
    showNotification(mensagem, 'error');
  }
}

function ftPadraoInit(pagina) {
  const estado = {
    fichaId: null,
    ficha: null,
    origemAtual: null,
    revisoes: [],
    versaoDetalheId: null,
    vinculoAjustesId: null,
    ajustes: [],
    editor: null
  };

  function limparErro() {
    const aviso = document.getElementById('ft-padrao-erro');
    if (aviso) {
      aviso.hidden = true;
      aviso.textContent = '';
    }
  }

  function mostrarErro(mensagem) {
    const aviso = document.getElementById('ft-padrao-erro');
    if (!aviso) return;
    aviso.hidden = false;
    aviso.textContent = mensagem;
  }

  function resposta(respostaApi, chave) {
    if (!respostaApi || respostaApi.success !== true || !respostaApi[chave]) {
      throw new Error('O servidor não confirmou a operação. Atualize a tela e tente novamente.');
    }
    return respostaApi[chave];
  }

  function entidade(respostaApi, chave, predicado, mensagem) {
    const valor = resposta(respostaApi, chave);
    if (predicado && !predicado(valor)) throw new Error(mensagem);
    return valor;
  }

  function marcarLinhaSabor(linha, estadoLinha) {
    const marcador = linha && linha.querySelector('[data-ft-origem-label]');
    if (!marcador) return;
    marcador.textContent = estadoLinha;
    marcador.hidden = !estadoLinha;
    linha.dataset.ftOrigemEstado = estadoLinha;
  }

  function compararCamposSabor(item, origem, campos) {
    return !!origem && campos.every((campo) => String(item[campo] == null ? '' : item[campo])
      === String(origem[campo] == null ? '' : origem[campo]));
  }

  function marcarEditorSabor(form, origem) {
    if (!form || !origem) return;
    for (const [campo, valor] of [
      ['rendimento_quantidade', origem.rendimento_quantidade],
      ['rendimento_unidade', origem.rendimento_unidade],
      ['observacoes', origem.observacoes]
    ]) {
      const input = form.querySelector(`[data-ft-sabor-campo="${campo}"]`);
      const marcador = form.querySelector(`[data-ft-sabor-campo-label="${campo}"]`);
      if (input && marcador) {
        const igual = String(input.value == null ? '' : input.value) === String(valor == null ? '' : valor);
        marcador.textContent = igual ? 'Herdado da ficha tradicional' : 'Personalizado para este sabor';
        marcador.hidden = false;
      }
    }
    form.querySelectorAll('#ft-padrao-componentes [data-ft-linha]').forEach((linha) => {
      const produtoId = Number(ftCampo(linha, 'produto_id'));
      const base = (origem.componentes || []).find((item) => Number(item.produto_id) === produtoId);
      const item = {
        descricao: ftCampo(linha, 'descricao'),
        quantidade: ftCampo(linha, 'quantidade'),
        unidade: ftCampo(linha, 'unidade'),
        observacao: ftCampo(linha, 'observacao')
      };
      marcarLinhaSabor(linha, !base
        ? 'Adicionado neste sabor'
        : compararCamposSabor(item, base, ['descricao', 'quantidade', 'unidade', 'observacao'])
          ? 'Herdado da ficha tradicional'
          : 'Personalizado para este sabor');
    });
    for (const [seletor, itens, campos] of [
      ['#ft-padrao-etapas', origem.etapas || [], ['titulo', 'descricao', 'tempo_minutos', 'observacao']],
      ['#ft-padrao-informacoes', origem.informacoes || [], ['titulo', 'valor']]
    ]) {
      form.querySelectorAll(`${seletor} [data-ft-linha]`).forEach((linha, indice) => {
        const item = {};
        campos.forEach((campo) => { item[campo] = ftCampo(linha, campo); });
        const base = itens[indice];
        marcarLinhaSabor(linha, !base
          ? 'Adicionado neste sabor'
          : compararCamposSabor(item, base, campos)
            ? 'Herdado da ficha tradicional'
            : 'Personalizado para este sabor');
      });
    }
  }

  function carregarOrigemParaSabor(fichaId) {
    const aviso = document.getElementById('ft-sabor-origem-resumo');
    const form = document.getElementById('ft-padrao-form');
    if (!fichaId || !form) {
      estado.origemAtual = null;
      if (aviso) aviso.textContent = 'Selecione uma ficha tradicional para carregar seu conteúdo integral.';
      return;
    }
    aviso.textContent = 'Carregando composição, etapas e informações...';
    ftApi('GET', `/fabrica-loja/fichas/${encodeURIComponent(fichaId)}`)
      .done((respostaApi) => {
        try {
          const origem = entidade(respostaApi, 'ficha', (item) =>
            Number(item.id) === Number(fichaId) && Array.isArray(item.componentes)
              && Array.isArray(item.etapas) && Array.isArray(item.informacoes),
          'A ficha tradicional retornada está incompleta.');
          estado.origemAtual = origem;
          document.getElementById('ft-padrao-rendimento').value =
            origem.rendimento_quantidade == null ? '' : origem.rendimento_quantidade;
          document.getElementById('ft-padrao-rendimento-unidade').value = origem.rendimento_unidade || '';
          document.getElementById('ft-padrao-observacoes').value = origem.observacoes || '';
          ftPreencherLista('#ft-padrao-componentes', origem.componentes, ftHtmlLinhaComponente);
          ftPreencherLista('#ft-padrao-etapas', origem.etapas, ftHtmlLinhaEtapa);
          ftPreencherLista('#ft-padrao-informacoes', origem.informacoes, ftHtmlLinhaInformacao);
          marcarEditorSabor(form, origem);
          aviso.textContent = `${origem.codigo} — ${origem.nome} · Rendimento ${origem.rendimento_quantidade || 'não informado'} ${origem.rendimento_unidade || ''} · revisão capturada em ${origem.updated_at || 'data indisponível'}.`;
        } catch (err) {
          mostrarErro(err.message);
          aviso.textContent = 'Não foi possível carregar a ficha tradicional.';
        }
      })
      .fail((err) => {
        aviso.textContent = 'Não foi possível carregar a ficha tradicional.';
        mostrarErro(ftPadraoMensagemErro(err, 'Não foi possível carregar a ficha tradicional.'));
      });
  }

  function carregarOpcoesOrigem() {
    const busca = document.getElementById('ft-sabor-origem-busca');
    const seletor = document.getElementById('ft-sabor-origem');
    if (!seletor) return;
    ftApi('GET', '/fabrica-loja/fichas')
      .done((respostaApi) => {
        try {
          const fichas = resposta(respostaApi, 'fichas');
          if (!Array.isArray(fichas)) throw new Error('A lista de fichas tradicionais retornada é inválida.');
          seletor.innerHTML = '<option value="">Selecione uma ficha tradicional</option>' + fichas
            .filter((ficha) => ficha.ativa)
            .map((ficha) => `<option value="${ftEsc(ficha.id)}" data-ft-origem-texto="${ftEsc(`${ficha.codigo} ${ficha.nome}`)}">${ftEsc(ficha.codigo)} — ${ftEsc(ficha.nome)} · ${ficha.componentes} ingredientes · ${ficha.etapas} etapas · ${ficha.informacoes} informações</option>`)
            .join('');
          const preview = document.getElementById('ft-sabor-origem-preview-selecao');
          if (preview) preview.innerHTML = seletor.innerHTML;
          if (estado.origemAtual && fichas.some((item) => Number(item.id) === Number(estado.origemAtual.id))) {
            seletor.value = String(estado.origemAtual.id);
          }
          if (busca) busca.disabled = false;
        } catch (err) {
          mostrarErro(err.message);
        }
      })
      .fail((err) => mostrarErro(ftPadraoMensagemErro(err, 'Não foi possível listar as fichas tradicionais.')));
  }

  function previsualizarOrigem() {
    const fichaId = document.getElementById('ft-sabor-origem-preview-selecao').value;
    const destino = document.getElementById('ft-sabor-origem-preview');
    if (!fichaId || !destino) {
      mostrarErro('Selecione uma ficha tradicional para visualizar.');
      return;
    }
    destino.textContent = 'Carregando pré-visualização...';
    ftApi('GET', `/fabrica-loja/fichas/${encodeURIComponent(fichaId)}`)
      .done((respostaApi) => {
        try {
          const origem = entidade(respostaApi, 'ficha', (item) => Number(item.id) === Number(fichaId),
            'A ficha tradicional retornada não corresponde à seleção.');
          destino.innerHTML = `
            <h5 class="h6">${ftEsc(origem.codigo)} — ${ftEsc(origem.nome)}</h5>
            <p>Rendimento: ${ftEsc(origem.rendimento_quantidade || 'Não informado')} ${ftEsc(origem.rendimento_unidade || '')}</p>
            <h6 class="h6">Composição</h6>
            <ul>${(origem.componentes || []).map((item) => `<li>${ftEsc(item.descricao)} — ${ftEsc(item.quantidade)} ${ftEsc(item.unidade)}${item.observacao ? ` · ${ftEsc(item.observacao)}` : ''}</li>`).join('') || '<li>Sem componentes</li>'}</ul>
            <h6 class="h6">Etapas</h6>
            <ol>${(origem.etapas || []).map((item) => `<li>${ftEsc(item.titulo)}${item.descricao ? ` — ${ftEsc(item.descricao)}` : ''}${item.tempo_minutos == null ? '' : ` (${ftEsc(item.tempo_minutos)} min)`}</li>`).join('') || '<li>Sem etapas</li>'}</ol>
            <h6 class="h6">Informações</h6>
            <dl>${(origem.informacoes || []).map((item) => `<dt>${ftEsc(item.titulo)}</dt><dd>${ftEsc(item.valor)}</dd>`).join('') || '<dd>Sem informações</dd>'}</dl>
            ${origem.observacoes ? `<p><strong>Observações:</strong> ${ftEsc(origem.observacoes)}</p>` : ''}`;
        } catch (err) {
          destino.textContent = '';
          mostrarErro(err.message);
        }
      })
      .fail((err) => {
        destino.textContent = '';
        mostrarErro(ftPadraoMensagemErro(err, 'Não foi possível visualizar a ficha tradicional.'));
      });
  }

  function executarMutacao(botao, requisicao, lerResposta, aoConcluir, fallback) {
    if (!botao || botao.disabled || botao.dataset.ftBusy === '1') return;
    botao.disabled = true;
    botao.dataset.ftBusy = '1';
    limparErro();
    return requisicao.done((respostaApi) => {
      try {
        aoConcluir(lerResposta(respostaApi));
      } catch (err) {
        mostrarErro(err.message || fallback);
      }
    }).fail((err) => {
      mostrarErro(ftPadraoMensagemErro(err, fallback));
    }).always(() => {
      if (botao.isConnected) {
        botao.disabled = false;
        delete botao.dataset.ftBusy;
      }
    });
  }

  function mostrarLista() {
    document.getElementById('ft-padrao-lista').hidden = false;
    document.getElementById('ft-padrao-detalhe').hidden = true;
    document.getElementById('ft-padrao-editor').hidden = true;
    document.getElementById('ft-padrao-ajustes').hidden = true;
    estado.editor = null;
    estado.vinculoAjustesId = null;
  }

  function carregarLista() {
    const busca = document.getElementById('ft-padrao-busca');
    const inativas = document.getElementById('ft-padrao-inativas');
    const params = new URLSearchParams();
    if (busca && busca.value.trim()) params.set('busca', busca.value.trim());
    if (inativas && inativas.checked) params.set('incluir_inativas', '1');
    const query = params.toString();
    const corpo = document.getElementById('ft-padrao-tbody');
    if (corpo) corpo.innerHTML = '<tr><td colspan="6" class="text-muted">Carregando fichas por sabor...</td></tr>';
    limparErro();
    ftApi('GET', '/fabrica-loja/fichas-sabor' + (query ? '?' + query : ''))
      .done((respostaApi) => {
        try {
          const fichas = resposta(respostaApi, 'fichas');
          if (!Array.isArray(fichas)) throw new Error('A lista de fichas por sabor retornada é inválida.');
          ftPadraoRenderLista(fichas);
        } catch (err) {
          mostrarErro(err.message);
        }
      })
      .fail((err) => mostrarErro(ftPadraoMensagemErro(err, 'Não foi possível carregar as fichas por sabor.')));
  }

  function renderVersaoConteudo(versao) {
    const destino = document.getElementById('ft-padrao-versao-conteudo');
    if (!destino) return;
    const componentes = versao.componentes || [];
    const etapas = versao.etapas || [];
    const informacoes = versao.informacoes || [];
    const origem = versao.ficha_tradicional_snapshot;
    const componentesOrigem = origem && origem.componentes || [];
    const removidos = componentesOrigem.filter((base) =>
      !componentes.some((item) => Number(item.produto_id) === Number(base.produto_id)));
    const etapasRemovidas = origem ? Math.max(0, origem.etapas.length - etapas.length) : 0;
    const informacoesRemovidas = origem ? Math.max(0, origem.informacoes.length - informacoes.length) : 0;
    const comparar = versao.ficha_tradicional_snapshot_anterior;
    const resumoComparacao = comparar && origem ? `
      <section class="ft-sabor-comparacao" aria-label="Comparação das origens">
        <h5 class="h6">Comparação da origem tradicional</h5>
        <p>Revisão anterior: ${ftEsc(comparar.atualizada_em || 'não informada')} · Nova revisão: ${ftEsc(origem.atualizada_em || 'não informada')}</p>
        <div class="table-responsive"><table class="table table-sm">
          <thead><tr><th>Componente</th><th>Antes</th><th>Nova origem</th></tr></thead>
          <tbody>${Array.from(new Set([
            ...comparar.componentes.map((item) => Number(item.produto_id)),
            ...origem.componentes.map((item) => Number(item.produto_id))
          ])).map((produtoId) => {
            const antes = comparar.componentes.find((item) => Number(item.produto_id) === produtoId);
            const depois = origem.componentes.find((item) => Number(item.produto_id) === produtoId);
            const registro = depois || antes;
            const exibir = (item) => item
              ? `${ftEsc(item.quantidade)} ${ftEsc(item.unidade)}${item.observacao ? ` · ${ftEsc(item.observacao)}` : ''}`
              : 'Não constava';
            return `<tr><td>${ftEsc(registro.descricao || `Insumo #${produtoId}`)}</td><td>${exibir(antes)}</td><td>${exibir(depois)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="mb-1">Etapas anteriores: ${comparar.etapas.map((item) => ftEsc(item.titulo)).join(' · ') || 'nenhuma'}</p>
        <p class="mb-1">Etapas novas: ${origem.etapas.map((item) => ftEsc(item.titulo)).join(' · ') || 'nenhuma'}</p>
        <p class="mb-0">Informações anteriores: ${comparar.informacoes.map((item) => ftEsc(item.titulo)).join(' · ') || 'nenhuma'} · Novas: ${origem.informacoes.map((item) => ftEsc(item.titulo)).join(' · ') || 'nenhuma'}</p>
      </section>` : '';
    const statusComponente = (item) => {
      if (!origem) return '';
      const base = componentesOrigem.find((origemItem) => Number(origemItem.produto_id) === Number(item.produto_id));
      if (!base) return 'Adicionado neste sabor';
      return compararCamposSabor(item, base, ['descricao', 'quantidade', 'unidade', 'observacao'])
        ? 'Herdado da ficha tradicional'
        : 'Personalizado para este sabor';
    };
    const statusOrdenado = (item, indice, itens) => {
      if (!origem) return '';
      const base = itens[indice];
      if (!base) return 'Adicionado neste sabor';
      const campos = itens === origem.etapas
        ? ['titulo', 'descricao', 'tempo_minutos', 'observacao']
        : ['titulo', 'valor'];
      return compararCamposSabor(item, base, campos)
        ? 'Herdado da ficha tradicional'
        : 'Personalizado para este sabor';
    };
    destino.innerHTML = `
      <section class="ft-padrao-subsecao" aria-label="Conteúdo da versão ${ftEsc(versao.numero_versao)}">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <h4 class="h6 mb-2">Versão ${ftEsc(versao.numero_versao)} — ${versao.estado === 'PUBLICADA' ? 'Publicada (somente leitura)' : 'Rascunho'}</h4>
          <button type="button" class="btn btn-link btn-sm" data-ft-padrao-acao="fechar-versao">Fechar</button>
        </div>
        ${origem ? `<p class="ft-sabor-origem-resumo">Origem: ${ftEsc(origem.codigo)} — ${ftEsc(origem.nome)} · revisão ${ftEsc(origem.revisao)} · snapshot de ${ftEsc(origem.atualizada_em || 'data indisponível')}</p>` : ''}
        <p class="mb-2">Rendimento: ${ftEsc(versao.rendimento_quantidade)} ${ftEsc(versao.rendimento_unidade)}</p>
        <h5 class="h6">Componentes da versão</h5>
        ${componentes.length ? `<ul>${componentes.map((item) => `<li>${ftEsc(item.descricao || `Insumo #${item.produto_id}`)} — ${ftEsc(item.quantidade)} ${ftEsc(item.unidade)}${item.observacao ? ` · ${ftEsc(item.observacao)}` : ''}${statusComponente(item) ? ` <span class="ft-sabor-status">${ftEsc(statusComponente(item))}</span>` : ''}</li>`).join('')}</ul>` : '<p class="text-muted">Sem componentes.</p>'}
        ${removidos.length ? `<p><strong>Removidos da composição herdada:</strong> ${removidos.map((item) => `${ftEsc(item.descricao || `Insumo #${item.produto_id}`)} (${ftEsc(item.quantidade)} ${ftEsc(item.unidade)})`).join('; ')}</p>` : ''}
        ${etapasRemovidas ? `<p><strong>Etapas herdadas removidas:</strong> ${etapasRemovidas}</p>` : ''}
        ${informacoesRemovidas ? `<p><strong>Informações herdadas removidas:</strong> ${informacoesRemovidas}</p>` : ''}
        ${etapas.length ? `<h5 class="h6">Etapas</h5><ol>${etapas.map((item, indice) => `<li>${ftEsc(item.titulo)}${item.descricao ? ` — ${ftEsc(item.descricao)}` : ''}${item.tempo_minutos == null ? '' : ` (${ftEsc(item.tempo_minutos)} min)`}${statusOrdenado(item, indice, origem && origem.etapas || []) ? ` <span class="ft-sabor-status">${ftEsc(statusOrdenado(item, indice, origem && origem.etapas || []))}</span>` : ''}</li>`).join('')}</ol>` : ''}
        ${informacoes.length ? `<h5 class="h6">Informações</h5><dl>${informacoes.map((item, indice) => `<dt>${ftEsc(item.titulo)}${statusOrdenado(item, indice, origem && origem.informacoes || []) ? ` <span class="ft-sabor-status">${ftEsc(statusOrdenado(item, indice, origem && origem.informacoes || []))}</span>` : ''}</dt><dd>${ftEsc(item.valor)}</dd>`).join('')}</dl>` : ''}
        ${versao.observacoes ? `<p><strong>Observações:</strong> ${ftEsc(versao.observacoes)}</p>` : ''}
        ${resumoComparacao}
      </section>`;
  }

  function versaoDoVinculo(vinculo) {
    return (estado.ficha && estado.ficha.versoes || [])
      .find((versao) => Number(versao.id) === Number(vinculo.versao_id));
  }

  function renderVinculos(vinculos) {
    if (!vinculos.length) return '<p class="text-muted">Nenhum produto vinculado.</p>';
    return `
      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle">
          <thead><tr><th>Produto</th><th>Versão atual</th><th>Atualização</th><th>Ações</th></tr></thead>
          <tbody>${vinculos.map((vinculo) => `
            <tr>
              <td>${vinculo.produto_codigo ? `${ftEsc(vinculo.produto_codigo)} — ` : ''}${ftEsc(vinculo.produto_nome)} <span class="text-muted">(#${ftEsc(vinculo.produto_id)})</span></td>
              <td>v${ftEsc(vinculo.numero_versao)}${vinculo.versao_estado === 'PUBLICADA' ? '' : ' · Rascunho'}</td>
              <td>${vinculo.versao_estado !== 'PUBLICADA' ? 'Aguardando publicação' : ftEsc(ftPadraoEstadoAtualizacao(vinculo.estado_atualizacao))}${vinculo.ativo ? '' : ' · Inativo'}</td>
              <td class="text-nowrap">
                <button type="button" class="btn btn-outline-secondary btn-sm" data-ft-padrao-acao="alternar-vinculo" data-vinculo-id="${ftEsc(vinculo.id)}" data-ativo="${vinculo.ativo ? '1' : '0'}">${vinculo.ativo ? 'Inativar' : 'Reativar'}</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderAtualizacoes(revisoes) {
    const pendentes = revisoes.filter((revisao) => revisao.estado === 'PENDENTE');
    if (!revisoes.length) return '<p class="text-muted">Ainda não há atualizações para os produtos vinculados.</p>';
    return `
      <div class="ft-padrao-atualizacoes">
        ${pendentes.length ? '' : '<p class="text-muted">Nenhuma atualização pendente.</p>'}
        ${revisoes.map((revisao) => `
          <article class="ft-padrao-atualizacao">
            <div>
              <strong>${ftEsc(revisao.produto_nome)}</strong>
              <span class="ft-padrao-status">${ftEsc(ftPadraoEstadoAtualizacao(revisao.estado))}</span>
              <p class="mb-1">Versão atual: v${ftEsc(revisao.versao_anterior)} · Versão proposta: v${ftEsc(revisao.versao_nova)}</p>
              ${revisao.justificativa ? `<p class="mb-1 text-muted">Justificativa: ${ftEsc(revisao.justificativa)}</p>` : ''}
              ${revisao.estado === 'PENDENTE' ? `<label class="form-label mb-1" for="ft-padrao-justificativa-${ftEsc(revisao.id)}">Justificativa (opcional)</label><input class="form-control form-control-sm mb-2" id="ft-padrao-justificativa-${ftEsc(revisao.id)}" data-ft-padrao-justificativa="${ftEsc(revisao.id)}" maxlength="500">` : ''}
            </div>
            ${revisao.estado === 'PENDENTE' ? `
              <div class="ft-padrao-acoes-revisao">
                ${revisao.vinculo_ativo ? `<button type="button" class="btn btn-success btn-sm" data-ft-padrao-acao="decidir" data-decisao="APROVAR" data-revisao-id="${ftEsc(revisao.id)}">Aprovar v${ftEsc(revisao.versao_nova)}</button><button type="button" class="btn btn-outline-secondary btn-sm" data-ft-padrao-acao="decidir" data-decisao="MANTER_ANTERIOR" data-revisao-id="${ftEsc(revisao.id)}">Manter versão atual</button>` : '<span class="text-muted">Vínculo inativo: decisão indisponível.</span>'}
              </div>` : ''}
          </article>`).join('')}
      </div>`;
  }

  function renderDetalhe() {
    const destino = document.getElementById('ft-padrao-detalhe');
    const ficha = estado.ficha;
    if (!destino || !ficha) return;
    const versoes = ficha.versoes || [];
    const rascunho = versoes.find((versao) => versao.estado === 'EM_EDICAO');
    const publicada = versoes.some((versao) => versao.estado === 'PUBLICADA');
    const origem = ficha.ficha_tradicional;
    const conteudoVersao = estado.versaoDetalheId == null
      ? ''
      : `<div id="ft-padrao-versao-conteudo"></div>`;
    destino.innerHTML = `
      <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-3">
        <div>
          <h3 class="h4 mb-1">${ftEsc(ficha.codigo)} — ${ftEsc(ficha.nome)}</h3>
          <p class="text-muted mb-0">${ficha.ativa ? 'Ficha por sabor ativa' : 'Ficha por sabor inativa'} · A publicação não atualiza produtos automaticamente.</p>
        </div>
        <div class="ft-padrao-acoes">
          <button type="button" class="btn btn-outline-secondary btn-sm" data-ft-padrao-acao="voltar-lista">Voltar</button>
          ${ficha.tipo === 'LEGADA' ? '<span class="badge text-bg-warning">Cadastro legado sem origem; não convertido</span>' : '          <button type="button" class="btn btn-outline-primary btn-sm" data-ft-padrao-acao="editar-ficha">Editar identificação</button>'}
          <button type="button" class="btn btn-primary btn-sm" data-ft-padrao-acao="nova-versao" ${!publicada || rascunho || !ficha.ativa ? 'disabled' : ''}>Criar versão</button>
          ${ficha.atualizacao_origem_disponivel ? `<button type="button" class="btn btn-warning btn-sm" data-ft-padrao-acao="revisar-origem" ${rascunho ? 'disabled title="Conclua o rascunho atual antes da revisão."' : ''}>Revisar nova origem</button>` : ''}
        </div>
      </div>
      ${origem ? `<section class="ft-sabor-origem-resumo"><h4 class="h6">Ficha tradicional de origem</h4><p class="mb-1">${ftEsc(origem.codigo)} — ${ftEsc(origem.nome)}</p><p class="mb-0">${ficha.atualizacao_origem_disponivel ? 'Há uma revisão mais recente disponível. Ela não foi aplicada automaticamente.' : 'A versão publicada permanece vinculada ao snapshot integral da origem usada.'}</p></section>` : ''}
      <section class="ft-padrao-bloco">
        <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <h4 class="h5 mb-2">Versões</h4>
          <button type="button" class="btn btn-outline-primary btn-sm" data-ft-padrao-acao="novo-vinculo" ${!publicada || !ficha.ativa ? 'disabled' : ''}>Associar produto</button>
        </div>
        ${rascunho ? '<p class="alert alert-warning py-2">Há um rascunho em edição. Edite ou publique esse rascunho antes de criar outra versão.</p>' : ''}
        ${versoes.length ? `
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle">
              <thead><tr><th>Versão</th><th>Estado</th><th>Rendimento</th><th>Componentes</th><th>Ações</th></tr></thead>
              <tbody>${versoes.map((versao) => `
                <tr>
                  <td>v${ftEsc(versao.numero_versao)}</td>
                  <td>${versao.estado === 'PUBLICADA' ? 'Publicada' : 'Rascunho'}</td>
                  <td>${ftEsc(versao.rendimento_quantidade)} ${ftEsc(versao.rendimento_unidade)}</td>
                  <td>${(versao.componentes || []).length}</td>
                  <td class="text-nowrap">
                    <button type="button" class="btn btn-link btn-sm" data-ft-padrao-acao="ver-versao" data-versao-id="${ftEsc(versao.id)}">Ver conteúdo</button>
                    ${versao.estado === 'EM_EDICAO' ? `<button type="button" class="btn btn-outline-primary btn-sm" data-ft-padrao-acao="editar-versao" data-versao-id="${ftEsc(versao.id)}">Editar rascunho</button><button type="button" class="btn btn-success btn-sm" data-ft-padrao-acao="publicar" data-versao-id="${ftEsc(versao.id)}"${ficha.ativa ? '' : ' disabled title="Ative a ficha por sabor para publicar."'}>Publicar</button>` : '<span class="text-muted">Imutável</span>'}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<p class="text-muted">Nenhuma versão cadastrada.</p>'}
        ${conteudoVersao}
      </section>
      <section class="ft-padrao-bloco">
        <h4 class="h5">Produtos vinculados</h4>
        ${renderVinculos(ficha.vinculos || [])}
      </section>
      <section class="ft-padrao-bloco">
        <h4 class="h5">Atualizações por produto</h4>
        <p class="text-muted">A aprovação ou manutenção da versão é individual para cada produto.</p>
        ${renderAtualizacoes(estado.revisoes)}
      </section>
      <p class="ft-padrao-nota">Os produtos vinculados utilizam o snapshot integral da versão publicada aprovada individualmente.</p>`;
    if (estado.versaoDetalheId != null) {
      const versao = versoes.find((item) => Number(item.id) === Number(estado.versaoDetalheId));
      if (versao) renderVersaoConteudo(versao);
    }
    document.getElementById('ft-padrao-lista').hidden = true;
    destino.hidden = false;
    document.getElementById('ft-padrao-editor').hidden = true;
    document.getElementById('ft-padrao-ajustes').hidden = true;
  }

  function carregarDetalhe(id, depois) {
    estado.fichaId = Number(id);
    estado.ficha = null;
    estado.revisoes = [];
    estado.versaoDetalheId = null;
    document.getElementById('ft-padrao-lista').hidden = true;
    document.getElementById('ft-padrao-editor').hidden = true;
    document.getElementById('ft-padrao-ajustes').hidden = true;
    const destino = document.getElementById('ft-padrao-detalhe');
    destino.hidden = false;
    destino.innerHTML = '<p class="text-muted">Carregando ficha e versões...</p>';
    limparErro();
    ftApi('GET', '/fabrica-loja/fichas-sabor/' + encodeURIComponent(id))
      .done((respostaApi) => {
        try {
          estado.ficha = entidade(respostaApi, 'ficha', (ficha) =>
            Number(ficha.id) === Number(id) && Array.isArray(ficha.versoes) && Array.isArray(ficha.vinculos),
          'O detalhe retornado pela API está incompleto.');
        } catch (err) {
          mostrarErro(err.message);
          return;
        }
        ftApi('GET', `/fabrica-loja/fichas-padrao/${encodeURIComponent(id)}/atualizacoes`)
          .done((revisoesApi) => {
            try {
              estado.revisoes = resposta(revisoesApi, 'atualizacoes');
              if (!Array.isArray(estado.revisoes)) throw new Error('A lista de atualizações retornada é inválida.');
              renderDetalhe();
              if (depois) depois();
            } catch (err) {
              mostrarErro(err.message);
            }
          })
          .fail((err) => {
            renderDetalhe();
            mostrarErro(ftPadraoMensagemErro(err, 'Não foi possível carregar as atualizações dos produtos.'));
          });
      })
      .fail((err) => mostrarErro(ftPadraoMensagemErro(err, 'Não foi possível consultar a ficha por sabor.')));
  }

  function abrirEditorFicha(tipo, versao) {
    const ficha = estado.ficha;
    const inicial = tipo === 'nova';
    const metadados = tipo === 'metadados';
    const produtosAssociados = (ficha && ficha.vinculos || []).map((vinculo) =>
      `${vinculo.produto_codigo ? `${vinculo.produto_codigo} — ` : ''}${vinculo.produto_nome} (#${vinculo.produto_id})`
    ).join('; ') || 'Nenhum produto associado';
    estado.editor = { tipo, versao: versao || null };
    const editor = document.getElementById('ft-padrao-editor');
    const camposVersao = !metadados;
    editor.innerHTML = `
      <form id="ft-padrao-form" data-tipo="${ftEsc(tipo)}" autocomplete="off">
        <div class="card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
                <h3 class="h5 mb-0">${inicial ? 'Nova ficha por sabor e versão inicial' : metadados ? 'Editar ficha por sabor' : `Editar rascunho v${ftEsc(versao.numero_versao)}`}</h3>
              <button type="button" class="btn btn-outline-secondary btn-sm" data-ft-padrao-acao="cancelar-editor">Voltar</button>
            </div>
              <p class="text-muted">A ficha por sabor herda a origem escolhida e pode ser personalizada sem alterar a ficha tradicional.</p>
            ${inicial || metadados ? `
              <div class="row g-2">
                <div class="col-md-4"><label class="form-label" for="ft-padrao-codigo">Código ${inicial ? '(opcional)' : ''}</label><input class="form-control" id="ft-padrao-codigo" maxlength="40" placeholder="${inicial ? 'Gerado automaticamente' : ''}" ${inicial ? '' : 'required'} value="${ftEsc(inicial ? '' : ficha.codigo)}"></div>
                  <div class="col-md-6"><label class="form-label" for="ft-padrao-nome">${inicial ? 'Nome do sabor' : 'Nome'}</label><input class="form-control" id="ft-padrao-nome" maxlength="160" required value="${ftEsc(inicial ? '' : ficha.nome)}"></div>
                ${metadados ? `<div class="col-md-2 d-flex align-items-end"><div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="ft-padrao-ativa" ${ficha.ativa ? 'checked' : ''}><label class="form-check-label" for="ft-padrao-ativa">Ativa</label></div></div>` : ''}
              </div>` : `<p class="text-muted mb-3">${ftEsc(ficha.codigo)} — ${ftEsc(ficha.nome)} · rascunho v${ftEsc(versao.numero_versao)}</p>`}
              ${metadados ? `<div class="mt-3"><label class="form-label" for="ft-padrao-produtos-associados">Produto(s) produzido(s) associado(s)</label><input class="form-control" id="ft-padrao-produtos-associados" value="${ftEsc(produtosAssociados)}" readonly><small class="form-text text-muted">Vínculos existentes são preservados; cadastros antigos não são associados automaticamente.</small></div>` : ''}
              ${inicial ? `
                <div class="mt-3 mb-3 ft-busca">
                  <label class="form-label" for="ft-padrao-produto-nome">Produto produzido associado *</label>
                  <input class="form-control" id="ft-padrao-produto-nome" data-ft-padrao-produto-busca autocomplete="off" placeholder="Buscar por código ou nome" required>
                  <input type="hidden" id="ft-padrao-produto-id">
                </div>` : ''}
              ${inicial ? `
                <section class="ft-sabor-origem mt-3">
                  <h4 class="h6">Ficha tradicional de origem</h4>
                  <label class="form-label" for="ft-sabor-origem-busca">Pesquisar fichas tradicionais</label>
                  <input class="form-control mb-2" id="ft-sabor-origem-busca" placeholder="Filtrar por código ou nome" autocomplete="off">
                  <label class="form-label" for="ft-sabor-origem-preview-selecao">Pré-visualizar uma origem sem vinculá-la ainda</label>
                  <select class="form-select" id="ft-sabor-origem-preview-selecao"><option value="">Carregando fichas tradicionais...</option></select>
                  <button type="button" class="btn btn-link px-0" data-ft-padrao-acao="visualizar-origem">Pré-visualizar ficha</button>
                  <div id="ft-sabor-origem-preview" class="ft-sabor-preview" aria-live="polite"></div>
                  <label class="form-label" for="ft-sabor-origem">Selecione a ficha tradicional</label>
                  <select class="form-select" id="ft-sabor-origem" required><option value="">Carregando fichas tradicionais...</option></select>
                  <p class="ft-sabor-origem-resumo mt-2 mb-0" id="ft-sabor-origem-resumo" aria-live="polite">Selecione uma ficha tradicional para carregar seu conteúdo integral.</p>
                </section>` : ''}
            ${camposVersao ? `
              <div class="row g-2 mt-1">
                <div class="col-md-4"><label class="form-label" for="ft-padrao-rendimento">Rendimento</label><small class="ft-sabor-origem-item" data-ft-sabor-campo-label="rendimento_quantidade" hidden></small><input class="form-control" id="ft-padrao-rendimento" data-ft-sabor-campo="rendimento_quantidade" inputmode="decimal" required value="${inicial ? '' : ftEsc(versao.rendimento_quantidade)}"></div>
                <div class="col-md-4"><label class="form-label" for="ft-padrao-rendimento-unidade">Unidade do rendimento</label><small class="ft-sabor-origem-item" data-ft-sabor-campo-label="rendimento_unidade" hidden></small><input class="form-control" id="ft-padrao-rendimento-unidade" data-ft-sabor-campo="rendimento_unidade" required value="${inicial ? '' : ftEsc(versao.rendimento_unidade)}"></div>
                <div class="col-12"><label class="form-label" for="ft-padrao-observacoes">Observações</label><small class="ft-sabor-origem-item" data-ft-sabor-campo-label="observacoes" hidden></small><textarea class="form-control" id="ft-padrao-observacoes" data-ft-sabor-campo="observacoes" rows="2">${inicial ? '' : ftEsc(versao.observacoes)}</textarea></div>
              </div>
              <div class="ft-bloco mt-3">
                <div class="d-flex justify-content-between align-items-center"><h4 class="h6">Componentes</h4><button type="button" class="btn btn-outline-primary btn-sm" data-ft-padrao-adicionar="componente">Adicionar componente</button></div>
                <div id="ft-padrao-componentes"></div>
                <div id="ft-sabor-removidos" class="ft-sabor-removidos" aria-live="polite"></div>
              </div>
              <div class="ft-bloco">
                <div class="d-flex justify-content-between align-items-center"><h4 class="h6">Etapas</h4><button type="button" class="btn btn-outline-primary btn-sm" data-ft-padrao-adicionar="etapa">Adicionar etapa</button></div>
                <div id="ft-padrao-etapas"></div>
              </div>
              <div class="ft-bloco">
                <div class="d-flex justify-content-between align-items-center"><h4 class="h6">Informações</h4><button type="button" class="btn btn-outline-primary btn-sm" data-ft-padrao-adicionar="informacao">Adicionar informação</button></div>
                <div id="ft-padrao-informacoes"></div>
              </div>` : ''}
          </div>
          <div class="card-footer d-flex justify-content-end gap-2">
            <button type="submit" class="btn btn-success" data-ft-padrao-salvar>${metadados ? 'Salvar ficha' : inicial ? 'Criar ficha por sabor' : 'Salvar rascunho'}</button>
          </div>
        </div>
      </form>`;
    if (camposVersao) {
      ftPreencherLista('#ft-padrao-componentes', inicial ? [] : versao.componentes, ftHtmlLinhaComponente);
      ftPreencherLista('#ft-padrao-etapas', inicial ? [] : versao.etapas, ftHtmlLinhaEtapa);
      ftPreencherLista('#ft-padrao-informacoes', inicial ? [] : versao.informacoes, ftHtmlLinhaInformacao);
      if (!inicial) {
        marcarEditorSabor(editor, versao.ficha_tradicional_snapshot);
        const origemAnterior = versao.ficha_tradicional_snapshot;
        if (origemAnterior) {
          const idsAtuais = new Set(versao.componentes.map((item) => Number(item.produto_id)));
          const destinoRemovidos = document.getElementById('ft-sabor-removidos');
          const removidos = origemAnterior.componentes.filter((item) => !idsAtuais.has(Number(item.produto_id)));
          if (destinoRemovidos && removidos.length) {
            destinoRemovidos.innerHTML = `<p>Removidos da composição herdada: ${removidos.map((item) => `${ftEsc(item.descricao)} (${ftEsc(item.quantidade)} ${ftEsc(item.unidade)})`).join('; ')}</p>`;
          }
        }
      }
    }
    document.getElementById('ft-padrao-lista').hidden = true;
    document.getElementById('ft-padrao-detalhe').hidden = true;
    document.getElementById('ft-padrao-ajustes').hidden = true;
    editor.hidden = false;
    const foco = document.getElementById(inicial || metadados ? 'ft-padrao-nome' : 'ft-padrao-rendimento');
    if (foco) foco.focus();
    if (inicial) carregarOpcoesOrigem();
  }

  function abrirEditorVinculo() {
    const editor = document.getElementById('ft-padrao-editor');
    const versoes = estado.ficha.versoes.filter((versao) => versao.estado === 'PUBLICADA');
    if (!versoes.length) {
      mostrarErro('Publique uma versão antes de associar produtos.');
      return;
    }
    estado.editor = { tipo: 'vinculo' };
    editor.innerHTML = `
      <form id="ft-padrao-form" data-tipo="vinculo" autocomplete="off">
        <div class="card"><div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-3"><h3 class="h5 mb-0">Vincular sabor ao produto produzido</h3><button type="button" class="btn btn-outline-secondary btn-sm" data-ft-padrao-acao="cancelar-editor">Voltar</button></div>
          <div class="mb-3 ft-busca">
            <label class="form-label" for="ft-padrao-produto-nome">Produto produzido</label>
            <input class="form-control" id="ft-padrao-produto-nome" data-ft-padrao-produto-busca autocomplete="off" placeholder="Buscar produto produzido...">
            <input type="hidden" id="ft-padrao-produto-id">
          </div>
          <div class="mb-3"><label class="form-label" for="ft-padrao-vinculo-versao">Versão publicada</label><select class="form-select" id="ft-padrao-vinculo-versao">${versoes.map((versao) => `<option value="${ftEsc(versao.id)}">v${ftEsc(versao.numero_versao)} — ${ftEsc(versao.rendimento_quantidade)} ${ftEsc(versao.rendimento_unidade)}</option>`).join('')}</select></div>
          <p class="text-muted">O produto passa a referenciar esta versão publicada. Atualizações futuras continuarão dependendo de aprovação individual.</p>
        </div><div class="card-footer d-flex justify-content-end"><button type="submit" class="btn btn-success" data-ft-padrao-salvar>Associar produto</button></div></div>
      </form>`;
    document.getElementById('ft-padrao-lista').hidden = true;
    document.getElementById('ft-padrao-detalhe').hidden = true;
    document.getElementById('ft-padrao-ajustes').hidden = true;
    editor.hidden = false;
    document.getElementById('ft-padrao-produto-nome').focus();
  }

  function abrirAjustes(vinculoId) {
    estado.vinculoAjustesId = Number(vinculoId);
    limparErro();
    document.getElementById('ft-padrao-lista').hidden = true;
    document.getElementById('ft-padrao-detalhe').hidden = true;
    document.getElementById('ft-padrao-editor').hidden = true;
    const destino = document.getElementById('ft-padrao-ajustes');
    destino.hidden = false;
    destino.innerHTML = '<p class="text-muted">Carregando ajustes do produto...</p>';
    ftApi('GET', `/fabrica-loja/fichas-padrao/vinculos/${encodeURIComponent(vinculoId)}/ajustes`)
      .done((respostaApi) => {
        try {
          estado.ajustes = resposta(respostaApi, 'ajustes');
          if (!Array.isArray(estado.ajustes)) throw new Error('A lista de ajustes retornada é inválida.');
          renderAjustes();
        } catch (err) {
          mostrarErro(err.message);
        }
      })
      .fail((err) => mostrarErro(ftPadraoMensagemErro(err, 'Não foi possível carregar os ajustes.')));
  }

  function renderAjustes() {
    const vinculo = (estado.ficha.vinculos || []).find((item) => Number(item.id) === estado.vinculoAjustesId);
    const versao = vinculo && versaoDoVinculo(vinculo);
    if (!vinculo || !versao) {
      mostrarErro('Não foi possível localizar a versão atual deste vínculo.');
      return;
    }
    const destino = document.getElementById('ft-padrao-ajustes');
    destino.innerHTML = `
      <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-3">
        <div><h3 class="h5 mb-1">Ajustes — ${ftEsc(vinculo.produto_nome)}</h3><p class="text-muted mb-0">Versão atual: v${ftEsc(vinculo.numero_versao)}. Ajustes não alteram a ficha por sabor.</p></div>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-ft-padrao-acao="voltar-detalhe">Voltar à ficha por sabor</button>
      </div>
      <p class="ft-padrao-nota">A API não fornece a composição final resolvida. As regras abaixo são apresentadas sem cálculo no navegador.</p>
      <div id="ft-padrao-ajustes-lista">${ftPadraoHtmlAjustes(estado.ajustes, versao.componentes, vinculo.ativo)}</div>
      ${vinculo.ativo ? `<div class="ft-padrao-bloco"><h4 class="h6">${estado.ajusteEditandoId ? 'Editar ajuste' : 'Novo ajuste'}</h4>
        <form id="ft-padrao-ajuste-form" data-ajuste-id="${estado.ajusteEditandoId || ''}">
          <div class="row g-2">
            <div class="col-md-4"><label class="form-label" for="ft-padrao-ajuste-operacao">Operação</label><select class="form-select" id="ft-padrao-ajuste-operacao"><option>HERDAR</option><option>SUBSTITUIR</option><option>ADICIONAR</option><option>REMOVER</option></select></div>
            <div class="col-md-8" data-ft-padrao-campo-base><label class="form-label" for="ft-padrao-ajuste-base">Componente da versão-base</label><select class="form-select" id="ft-padrao-ajuste-base"><option value="">Selecione um componente</option>${versao.componentes.map((item) => {
              const jaAjustado = estado.ajustes.some((ajuste) =>
                Number(ajuste.componente_base_id) === Number(item.componente_base_id)
                && Number(ajuste.id) !== Number(estado.ajusteEditandoId || 0));
              return `<option value="${ftEsc(item.componente_base_id)}"${jaAjustado ? ' disabled' : ''}>${ftEsc(item.descricao)} — ${ftEsc(item.quantidade)} ${ftEsc(item.unidade)}${jaAjustado ? ' (já possui ajuste)' : ''}</option>`;
            }).join('')}</select></div>
            <div class="col-md-8 ft-busca" data-ft-padrao-campo-adicionar hidden><label class="form-label" for="ft-padrao-ajuste-insumo-nome">Insumo adicional</label><input class="form-control" id="ft-padrao-ajuste-insumo-nome" data-ft-padrao-insumo-busca autocomplete="off" placeholder="Buscar insumo..."><input type="hidden" id="ft-padrao-ajuste-insumo-id" data-ft-padrao-insumo-id></div>
            <div class="col-md-4" data-ft-padrao-campo-quantidade hidden><label class="form-label" for="ft-padrao-ajuste-quantidade">Quantidade</label><input class="form-control" id="ft-padrao-ajuste-quantidade" inputmode="decimal"></div>
            <div class="col-md-4" data-ft-padrao-campo-unidade hidden><label class="form-label" for="ft-padrao-ajuste-unidade">Unidade</label><input class="form-control" id="ft-padrao-ajuste-unidade"></div>
            <div class="col-12"><label class="form-label" for="ft-padrao-ajuste-justificativa">Justificativa (opcional)</label><input class="form-control" id="ft-padrao-ajuste-justificativa" maxlength="500"></div>
          </div>
          <div class="d-flex justify-content-end gap-2 mt-3"><button type="button" class="btn btn-outline-secondary btn-sm" data-ft-padrao-acao="cancelar-ajuste">Limpar</button><button type="submit" class="btn btn-primary btn-sm" data-ft-padrao-salvar>Salvar ajuste</button></div>
        </form></div>` : '<p class="alert alert-warning">Vínculo inativo: os ajustes estão somente para consulta.</p>'}`;
    const form = document.getElementById('ft-padrao-ajuste-form');
    if (form && estado.ajusteEditandoId) {
      const ajuste = estado.ajustes.find((item) => Number(item.id) === Number(estado.ajusteEditandoId));
      if (ajuste) {
        document.getElementById('ft-padrao-ajuste-operacao').value = ajuste.operacao;
        if (ajuste.componente_base_id != null) document.getElementById('ft-padrao-ajuste-base').value = ajuste.componente_base_id;
        document.getElementById('ft-padrao-ajuste-quantidade').value = ajuste.quantidade == null ? '' : ajuste.quantidade;
        document.getElementById('ft-padrao-ajuste-unidade').value = ajuste.unidade || '';
        document.getElementById('ft-padrao-ajuste-justificativa').value = ajuste.justificativa || '';
        if (ajuste.operacao === 'ADICIONAR') {
          document.getElementById('ft-padrao-ajuste-insumo-id').value = ajuste.produto_id;
          document.getElementById('ft-padrao-ajuste-insumo-nome').value = `Insumo #${ajuste.produto_id}`;
        }
      }
    }
    atualizarCamposAjuste();
    document.getElementById('ft-padrao-lista').hidden = true;
    document.getElementById('ft-padrao-detalhe').hidden = true;
    document.getElementById('ft-padrao-editor').hidden = true;
    destino.hidden = false;
  }

  function atualizarCamposAjuste() {
    const form = document.getElementById('ft-padrao-ajuste-form');
    if (!form) return;
    const operacao = document.getElementById('ft-padrao-ajuste-operacao').value;
    const adicional = operacao === 'ADICIONAR';
    const substituicao = operacao === 'SUBSTITUIR';
    form.querySelector('[data-ft-padrao-campo-base]').hidden = adicional;
    form.querySelector('[data-ft-padrao-campo-adicionar]').hidden = !adicional;
    form.querySelector('[data-ft-padrao-campo-quantidade]').hidden = !adicional && !substituicao;
    form.querySelector('[data-ft-padrao-campo-unidade]').hidden = !adicional && !substituicao;
    const unidade = document.getElementById('ft-padrao-ajuste-unidade');
    if (substituicao) {
      const id = Number(document.getElementById('ft-padrao-ajuste-base').value);
      const vinculo = (estado.ficha.vinculos || []).find((item) => Number(item.id) === estado.vinculoAjustesId);
      const versao = vinculo && versaoDoVinculo(vinculo);
      const componente = versao && versao.componentes.find((item) => Number(item.componente_base_id) === id);
      unidade.value = componente ? componente.unidade : '';
      unidade.readOnly = true;
    } else {
      unidade.readOnly = !adicional;
      if (!adicional) unidade.value = '';
    }
  }

  function buscarProdutoPadrao(input, callback, endpoint, chave, modo, erroFallback) {
    const termo = input.value.trim();
    if (termo.length < 2) {
      const lista = input.parentElement.querySelector('.ft-sugestoes');
      if (lista) lista.remove();
      return;
    }
    input._ftBuscaSeq = (input._ftBuscaSeq || 0) + 1;
    const sequencia = input._ftBuscaSeq;
    ftApi('GET', endpoint(termo))
      .done((respostaApi) => {
        try {
          const itens = resposta(respostaApi, chave);
          if (!Array.isArray(itens)) throw new Error('A resposta de busca retornada é inválida.');
          if (!input.isConnected || input._ftBuscaSeq !== sequencia || input.value.trim() !== termo) return;
          ftPosicionarSugestoes(input.parentElement, itens.slice(0, 8), callback, modo);
        } catch (err) {
          mostrarErro(err.message);
        }
      })
      .fail((err) => mostrarErro(ftPadraoMensagemErro(err, erroFallback)));
  }

  function renderDetalheAposAtualizacao(vinculoId) {
    carregarDetalhe(estado.fichaId, () => {
      if (vinculoId) abrirAjustes(vinculoId);
    });
  }

  pagina.addEventListener('click', (evento) => {
    const alvo = evento.target;
    const aba = alvo.closest('[data-ft-tab]');
    if (aba) {
      const padraoAtivo = aba.dataset.ftTab === 'padrao';
      document.getElementById('ft-area-legada').hidden = padraoAtivo;
      document.getElementById('ft-area-padrao').hidden = !padraoAtivo;
      pagina.querySelectorAll('[data-ft-tab]').forEach((botao) => {
        const selecionado = botao === aba;
        botao.classList.toggle('active', selecionado);
        botao.setAttribute('aria-selected', selecionado ? 'true' : 'false');
      });
      if (padraoAtivo) carregarLista();
      return;
    }

    const acao = alvo.closest('[data-ft-padrao-acao]');
    if (acao) {
      const tipo = acao.dataset.ftPadraoAcao;
      if (tipo === 'visualizar-origem') {
        previsualizarOrigem();
      } else if (tipo === 'nova-ficha') {
        estado.origemAtual = null;
        abrirEditorFicha('nova');
      } else if (tipo === 'abrir-ficha') {
        carregarDetalhe(acao.dataset.fichaId);
      } else if (tipo === 'alternar-status') {
        const fichaId = Number(acao.dataset.fichaId);
        const ativa = acao.dataset.ativa !== '1';
        const verbo = ativa ? 'ativar' : 'inativar';
        const impacto = ativa
          ? 'A ficha voltará a ficar disponível para associação aos produtos.'
          : 'A ficha deixará de ficar disponível para todos os produtos vinculados.';
        if (!window.confirm(`Confirmar ${verbo} esta ficha por sabor? ${impacto}`)) return;
        executarMutacao(acao, ftApi('PATCH', `/fabrica-loja/fichas-padrao/${fichaId}/status`, { ativa }), (data) =>
          entidade(data, 'ficha', (ficha) => ficha.ativa === ativa, 'O servidor não confirmou a alteração da situação.'),
        () => {
          if (typeof showNotification === 'function') showNotification(`Ficha por sabor ${ativa ? 'ativada' : 'inativada'}.`, 'success');
          carregarLista();
        }, 'Não foi possível alterar a situação da ficha.');
      } else if (tipo === 'excluir-ficha') {
        const fichaId = Number(acao.dataset.fichaId);
        const ehFichaSabor = acao.dataset.fichaTipo === 'SABOR';
        const confirmacao = ehFichaSabor
          ? 'Excluir esta ficha por sabor definitivamente? Os produtos associados serão desvinculados; versões, revisões e ajustes desta ficha serão apagados. Snapshots de produção existentes serão preservados.'
          : 'Excluir este cadastro legado definitivamente? Os dados e versões serão apagados.';
        if (!window.confirm(confirmacao)) return;
        executarMutacao(acao, ftApi('DELETE', `/fabrica-loja/fichas-padrao/${fichaId}`), (data) => {
          if (!data || data.success !== true || data.removida !== true) {
            throw new Error('O servidor não confirmou a exclusão do cadastro legado.');
          }
          return data;
        }, () => {
          if (typeof showNotification === 'function') {
            showNotification(ehFichaSabor ? 'Ficha por sabor excluída e produtos desvinculados.' : 'Cadastro legado excluído.', 'success');
          }
          carregarLista();
        }, 'Não foi possível excluir o cadastro legado.');
      } else if (tipo === 'voltar-lista') {
        estado.fichaId = null;
        estado.ficha = null;
        mostrarLista();
        carregarLista();
      } else if (tipo === 'editar-ficha') {
        abrirEditorFicha('metadados');
      } else if (tipo === 'cancelar-editor') {
        if (estado.ficha) renderDetalhe();
        else mostrarLista();
      } else if (tipo === 'nova-versao') {
        const button = acao;
        const fichaId = estado.fichaId;
        executarMutacao(button, ftApi('POST', `/fabrica-loja/fichas-padrao/${fichaId}/versoes`), (data) =>
          entidade(data, 'versao', (versao) => versao.estado === 'EM_EDICAO', 'O servidor não retornou o rascunho esperado.'),
        (versao) => carregarDetalhe(fichaId, () => abrirEditorFicha('versao', estado.ficha.versoes.find((item) => Number(item.id) === Number(versao.id)))),
        'Não foi possível criar o rascunho.');
      } else if (tipo === 'revisar-origem') {
        const fichaId = estado.fichaId;
        executarMutacao(acao, ftApi('POST', `/fabrica-loja/fichas-sabor/${fichaId}/revisar-origem`, {}), (data) =>
          entidade(data, 'versao', (versao) => versao.estado === 'EM_EDICAO' && !!versao.ficha_tradicional_snapshot_anterior, 'O servidor não retornou o rascunho com a comparação da origem.'),
        (versao) => carregarDetalhe(fichaId, () => {
          const rascunho = estado.ficha.versoes.find((item) => Number(item.id) === Number(versao.id));
          if (rascunho) abrirEditorFicha('versao', rascunho);
          if (typeof showNotification === 'function') showNotification('Nova origem carregada em rascunho. Revise as diferenças e publique quando estiver pronto.', 'success');
        }), 'Não foi possível revisar a ficha tradicional.');
      } else if (tipo === 'ver-versao') {
        estado.versaoDetalheId = Number(acao.dataset.versaoId);
        renderDetalhe();
      } else if (tipo === 'fechar-versao') {
        estado.versaoDetalheId = null;
        renderDetalhe();
      } else if (tipo === 'editar-versao') {
        const versao = estado.ficha.versoes.find((item) => Number(item.id) === Number(acao.dataset.versaoId));
        if (versao && versao.estado === 'EM_EDICAO') abrirEditorFicha('versao', versao);
      } else if (tipo === 'publicar') {
        const versaoId = Number(acao.dataset.versaoId);
        const versao = estado.ficha.versoes.find((item) => Number(item.id) === versaoId);
        if (!versao || versao.estado !== 'EM_EDICAO') {
          mostrarErro('Somente um rascunho pode ser publicado.');
          return;
        }
        if (!window.confirm(`Publicar a versão ${versao.numero_versao}? Isso não aprovará a versão para nenhum produto vinculado.`)) return;
        const fichaId = estado.fichaId;
        executarMutacao(acao, ftApi('POST', `/fabrica-loja/fichas-padrao/${fichaId}/versoes/${versaoId}/publicar`), (data) =>
          entidade(data, 'versao', (item) => item.estado === 'PUBLICADA', 'O servidor não confirmou a publicação.'),
        () => {
          if (typeof showNotification === 'function') showNotification('Versão publicada. Nenhum produto foi atualizado automaticamente.', 'success');
          carregarDetalhe(fichaId);
        }, 'Não foi possível publicar a versão.');
      } else if (tipo === 'novo-vinculo') {
        abrirEditorVinculo();
      } else if (tipo === 'ajustes') {
        abrirAjustes(acao.dataset.vinculoId);
      } else if (tipo === 'voltar-detalhe') {
        estado.ajusteEditandoId = null;
        renderDetalhe();
      } else if (tipo === 'editar-ajuste') {
        estado.ajusteEditandoId = Number(acao.dataset.ajusteId);
        renderAjustes();
      } else if (tipo === 'cancelar-ajuste') {
        estado.ajusteEditandoId = null;
        renderAjustes();
      } else if (tipo === 'remover-ajuste') {
        const ajusteId = Number(acao.dataset.ajusteId);
        if (!window.confirm('Remover esta regra de ajuste?')) return;
        executarMutacao(acao, ftApi('DELETE', `/fabrica-loja/fichas-padrao/vinculos/${estado.vinculoAjustesId}/ajustes/${ajusteId}`), (data) => {
          if (!data || data.success !== true || data.removido !== true) throw new Error('O servidor não confirmou a remoção do ajuste.');
          return data;
        }, () => {
          estado.ajusteEditandoId = null;
          abrirAjustes(estado.vinculoAjustesId);
        }, 'Não foi possível remover o ajuste.');
      } else if (tipo === 'alternar-vinculo') {
        const vinculoId = Number(acao.dataset.vinculoId);
        const ativo = acao.dataset.ativo !== '1';
        const verbo = ativo ? 'reativar' : 'inativar';
        if (!window.confirm(`Confirmar ${verbo} o vínculo deste produto?`)) return;
        executarMutacao(acao, ftApi('PUT', `/fabrica-loja/fichas-padrao/vinculos/${vinculoId}`, { ativo }), (data) =>
          entidade(data, 'vinculo', (item) => item.ativo === ativo, 'O servidor não confirmou a alteração do vínculo.'),
        () => carregarDetalhe(estado.fichaId), 'Não foi possível alterar o vínculo.');
      } else if (tipo === 'decidir') {
        const revisaoId = Number(acao.dataset.revisaoId);
        const decisao = acao.dataset.decisao;
        const revisao = estado.revisoes.find((item) => Number(item.id) === revisaoId && item.estado === 'PENDENTE');
        if (!revisao || !['APROVAR', 'MANTER_ANTERIOR'].includes(decisao)) {
          mostrarErro('Esta atualização não está mais pendente. Atualize os dados antes de decidir.');
          return;
        }
        const descricao = decisao === 'APROVAR' ? 'aprovar a versão proposta' : 'manter a versão atual';
        if (!window.confirm(`Confirmar ${descricao} para ${revisao.produto_nome} (v${revisao.versao_anterior} → v${revisao.versao_nova})? A decisão não afetará outros produtos.`)) return;
        const justificativa = document.querySelector(`[data-ft-padrao-justificativa="${revisaoId}"]`);
        executarMutacao(acao, ftApi('PUT', `/fabrica-loja/fichas-padrao/atualizacoes/${revisaoId}`, {
          decisao,
          justificativa: justificativa ? justificativa.value : ''
        }), (data) => entidade(data, 'revisao', (item) =>
          item.estado === (decisao === 'APROVAR' ? 'APROVADO' : 'MANTER_ANTERIOR'),
        'O servidor não confirmou a decisão individual.'), () => {
          if (typeof showNotification === 'function') {
            showNotification(decisao === 'APROVAR' ? 'Atualização aprovada para este produto.' : 'O produto continuará na versão atual.', 'success');
          }
          carregarDetalhe(estado.fichaId);
        }, 'Não foi possível registrar a decisão.');
      }
      return;
    }

    const adicionar = alvo.closest('[data-ft-padrao-adicionar]');
    if (adicionar) {
      const tipo = adicionar.dataset.ftPadraoAdicionar;
      const mapa = {
        componente: ['#ft-padrao-componentes', ftHtmlLinhaComponente],
        etapa: ['#ft-padrao-etapas', ftHtmlLinhaEtapa],
        informacao: ['#ft-padrao-informacoes', ftHtmlLinhaInformacao]
      };
      if (mapa[tipo]) {
        const grupo = document.querySelector(mapa[tipo][0]);
        grupo.insertAdjacentHTML('beforeend', mapa[tipo][1]({}));
        marcarLinhaSabor(grupo.lastElementChild, 'Adicionado neste sabor');
      }
      return;
    }

    if (alvo.closest('[data-ft-remover]')) {
      const linha = alvo.closest('[data-ft-linha]');
      const estadoOrigem = linha && linha.dataset.ftOrigemEstado;
      if (estadoOrigem === 'Herdado da ficha tradicional'
        || estadoOrigem === 'Personalizado para este sabor') {
        const removidos = document.getElementById('ft-sabor-removidos');
        if (removidos) {
          const nome = ftCampo(linha, 'descricao') || ftCampo(linha, 'titulo') || ftCampo(linha, 'produto_id');
          const aviso = document.createElement('p');
          aviso.textContent = `Removido da origem: ${nome}`;
          removidos.appendChild(aviso);
        }
      }
      const grupo = linha && linha.parentElement;
      if (grupo && !grupo.querySelector('[data-ft-linha]')) {
        const porId = {
          'ft-padrao-componentes': ftHtmlLinhaComponente,
          'ft-padrao-etapas': ftHtmlLinhaEtapa,
          'ft-padrao-informacoes': ftHtmlLinhaInformacao
        };
        if (porId[grupo.id]) grupo.insertAdjacentHTML('beforeend', porId[grupo.id]({}));
      }
    }
  });

  pagina.addEventListener('input', (evento) => {
    const alvo = evento.target;
    if (alvo.id === 'ft-padrao-busca') {
      clearTimeout(pagina._ftPadraoBusca);
      pagina._ftPadraoBusca = setTimeout(carregarLista, 250);
    } else if (alvo.id === 'ft-sabor-origem-busca') {
      const termo = alvo.value.trim().toLocaleLowerCase('pt-BR');
      const seletor = document.getElementById('ft-sabor-origem');
      if (seletor) {
        Array.from(seletor.options).forEach((opcao, indice) => {
          if (indice === 0) return;
          opcao.hidden = !!termo && !opcao.textContent.toLocaleLowerCase('pt-BR').includes(termo);
        });
      }
    } else if (alvo.closest('#ft-padrao-form [data-ft-linha]')) {
      const linha = alvo.closest('[data-ft-linha]');
      if (linha.dataset.ftOrigemEstado !== 'Adicionado neste sabor') {
        marcarLinhaSabor(linha, 'Personalizado para este sabor');
      }
    } else if (alvo.matches('[data-ft-sabor-campo]')) {
      const marcador = document.querySelector(`[data-ft-sabor-campo-label="${alvo.dataset.ftSaborCampo}"]`);
      if (marcador) {
        marcador.textContent = 'Personalizado para este sabor';
        marcador.hidden = false;
      }
    } else if (alvo.matches('[data-ft-padrao-produto-busca]')) {
      document.getElementById('ft-padrao-produto-id').value = '';
      buscarProdutoPadrao(
        alvo,
        (produto) => {
          alvo.value = `${produto.codigo ? `${produto.codigo} — ` : ''}${produto.nome || ''}`;
          document.getElementById('ft-padrao-produto-id').value = produto.id || '';
        },
        (termo) => `/fabrica-loja/produtos-produzidos?excluir_produto_linha=1&q=${encodeURIComponent(termo)}`,
        'produtos',
        'produzido',
        'Não foi possível buscar produtos produzidos.'
      );
    } else if (alvo.matches('[data-ft-padrao-insumo-busca]')) {
      document.getElementById('ft-padrao-ajuste-insumo-id').value = '';
      buscarProdutoPadrao(
        alvo,
        (produto) => {
          const vinculo = (estado.ficha.vinculos || []).find((item) => Number(item.id) === estado.vinculoAjustesId);
          const versao = vinculo && versaoDoVinculo(vinculo);
          const jaBase = versao && versao.componentes.some((item) => Number(item.produto_id) === Number(produto.id));
          const ajusteAtualId = Number(document.getElementById('ft-padrao-ajuste-form').dataset.ajusteId || 0);
          const jaAjustado = estado.ajustes.some((item) =>
            Number(item.produto_id) === Number(produto.id) && Number(item.id) !== ajusteAtualId);
          if (jaBase || jaAjustado) {
            mostrarErro(jaBase
              ? 'Este insumo já está na versão-base. Use SUBSTITUIR para alterar sua quantidade.'
              : 'Já existe uma regra para este insumo neste produto.');
            return;
          }
          alvo.value = produto.nome || '';
          document.getElementById('ft-padrao-ajuste-insumo-id').value = produto.id || '';
        },
        (termo) => `/fabrica-loja/insumos?q=${encodeURIComponent(termo)}`,
        'insumos',
        'insumo',
        'Não foi possível buscar insumos.'
      );
    }
  });

  pagina.addEventListener('change', (evento) => {
    const alvo = evento.target;
    if (alvo.id === 'ft-padrao-inativas') carregarLista();
    if (alvo.id === 'ft-padrao-ajuste-operacao' || alvo.id === 'ft-padrao-ajuste-base') atualizarCamposAjuste();
    if (alvo.id === 'ft-sabor-origem') {
      const origemAnterior = estado.origemAtual;
      if (origemAnterior && Number(origemAnterior.id) !== Number(alvo.value)
        && !window.confirm('Trocar a origem carregará outra ficha e substituirá os dados atuais do rascunho. Continuar?')) {
        alvo.value = String(origemAnterior.id);
        return;
      }
      carregarOrigemParaSabor(alvo.value);
    }
  });

  pagina.addEventListener('submit', (evento) => {
    const form = evento.target;
    if (!form || form.id !== 'ft-padrao-form') return;
    evento.preventDefault();
    if (form.dataset.ftBusy === '1') return;
    form.dataset.ftBusy = '1';
    const botao = form.querySelector('[data-ft-padrao-salvar]');
    limparErro();
    const tipo = form.dataset.tipo;

    if (tipo === 'vinculo') {
      const produtoId = document.getElementById('ft-padrao-produto-id').value;
      const versaoId = document.getElementById('ft-padrao-vinculo-versao').value;
      if (!produtoId) {
        form.dataset.ftBusy = '0';
        if (botao) botao.disabled = false;
        mostrarErro('Selecione um produto produzido da lista.');
        return;
      }
      executarMutacao(botao, ftApi('POST', `/fabrica-loja/fichas-padrao/${estado.fichaId}/vinculos`, {
        produto_id: produtoId,
        versao_id: versaoId
      }), (data) => entidade(data, 'vinculo', (item) => Number(item.produto_id) === Number(produtoId) && Number(item.versao_id) === Number(versaoId), 'O servidor não confirmou o vínculo solicitado.'), () => {
        estado.editor = null;
        carregarDetalhe(estado.fichaId);
        if (typeof showNotification === 'function') showNotification('Produto associado à versão selecionada.', 'success');
      }, 'Não foi possível associar o produto.').always(() => { form.dataset.ftBusy = '0'; });
      return;
    }

    if (tipo === 'metadados') {
      const dados = {
        codigo: document.getElementById('ft-padrao-codigo').value,
        nome: document.getElementById('ft-padrao-nome').value,
        ativa: document.getElementById('ft-padrao-ativa').checked
      };
      executarMutacao(botao, ftApi('PUT', `/fabrica-loja/fichas-padrao/${estado.fichaId}`, dados), (data) =>
        entidade(data, 'ficha', (item) => Number(item.id) === estado.fichaId, 'O servidor não confirmou a atualização da ficha.'),
      () => carregarDetalhe(estado.fichaId), 'Não foi possível atualizar a ficha por sabor.').always(() => { form.dataset.ftBusy = '0'; });
      return;
    }

    const versao = {
      rendimento_quantidade: document.getElementById('ft-padrao-rendimento').value,
      rendimento_unidade: document.getElementById('ft-padrao-rendimento-unidade').value,
      observacoes: document.getElementById('ft-padrao-observacoes').value
    };
    try {
      versao.componentes = ftPadraoColetarComponentes(form);
      versao.etapas = ftPadraoColetarEtapas(form);
      versao.informacoes = ftPadraoColetarInformacoes(form);
      if (!versao.componentes.length) throw new Error('Inclua pelo menos um componente na versão.');
      if (!String(versao.rendimento_quantidade).trim() || !String(versao.rendimento_unidade).trim()) {
        throw new Error('Informe o rendimento e sua unidade.');
      }
    } catch (err) {
      form.dataset.ftBusy = '0';
      if (botao) botao.disabled = false;
      mostrarErro(err.message);
      return;
    }

    const criar = tipo === 'nova';
    const fichaTradicionalId = criar ? document.getElementById('ft-sabor-origem').value : null;
    const produtoId = criar ? document.getElementById('ft-padrao-produto-id').value : null;
    if (criar && !produtoId) {
      form.dataset.ftBusy = '0';
      if (botao) botao.disabled = false;
      mostrarErro('Selecione um produto produzido existente.');
      return;
    }
    if (criar && !fichaTradicionalId) {
      form.dataset.ftBusy = '0';
      if (botao) botao.disabled = false;
      mostrarErro('Selecione uma ficha tradicional de origem.');
      return;
    }
    const url = criar
      ? '/fabrica-loja/fichas-sabor'
      : `/fabrica-loja/fichas-padrao/${estado.fichaId}/versoes/${estado.editor.versao.id}`;
    const dados = criar ? {
      codigo: document.getElementById('ft-padrao-codigo').value,
      nome: document.getElementById('ft-padrao-nome').value,
      produto_id: produtoId,
      ficha_tradicional_id: fichaTradicionalId,
      ...versao
    } : versao;
    executarMutacao(botao, ftApi(criar ? 'POST' : 'PUT', url, dados), (data) => {
      if (criar) {
        const ficha = entidade(data, 'ficha', (item) => Number(item.id) > 0
          && Number(item.ficha_tradicional_id) === Number(fichaTradicionalId)
          && Array.isArray(item.versoes), 'O servidor não retornou a ficha por sabor criada.');
        if (!ficha.versoes.some((item) => item.estado === 'EM_EDICAO')) throw new Error('A ficha foi retornada sem o rascunho inicial.');
        return ficha;
      }
      return entidade(data, 'versao', (item) => Number(item.id) === Number(estado.editor.versao.id) && item.estado === 'EM_EDICAO', 'O servidor não confirmou o salvamento do rascunho.');
    }, (resultado) => {
      estado.editor = null;
      if (criar) {
        estado.fichaId = resultado.id;
        carregarDetalhe(resultado.id);
        if (typeof showNotification === 'function') showNotification('Ficha por sabor criada com versão inicial em rascunho.', 'success');
      } else {
        carregarDetalhe(estado.fichaId);
        if (typeof showNotification === 'function') showNotification('Rascunho atualizado.', 'success');
      }
    }, 'Não foi possível salvar a ficha ou o rascunho.').always(() => { form.dataset.ftBusy = '0'; });
  });

  pagina.addEventListener('submit', (evento) => {
    const form = evento.target;
    if (!form || form.id !== 'ft-padrao-ajuste-form') return;
    evento.preventDefault();
    if (form.dataset.ftBusy === '1') return;
    form.dataset.ftBusy = '1';
    const botao = form.querySelector('[data-ft-padrao-salvar]');
    const operacao = document.getElementById('ft-padrao-ajuste-operacao').value;
    const dados = {
      operacao,
      justificativa: document.getElementById('ft-padrao-ajuste-justificativa').value
    };
    if (operacao === 'ADICIONAR') {
      dados.produto_id = document.getElementById('ft-padrao-ajuste-insumo-id').value;
      dados.quantidade = document.getElementById('ft-padrao-ajuste-quantidade').value;
      dados.unidade = document.getElementById('ft-padrao-ajuste-unidade').value;
      if (!dados.produto_id) {
        form.dataset.ftBusy = '0';
        mostrarErro('Selecione um insumo adicional da lista.');
        return;
      }
    } else {
      dados.componente_base_id = document.getElementById('ft-padrao-ajuste-base').value;
      if (!dados.componente_base_id) {
        form.dataset.ftBusy = '0';
        mostrarErro('Selecione um componente da versão-base.');
        return;
      }
      if (operacao === 'SUBSTITUIR') {
        dados.quantidade = document.getElementById('ft-padrao-ajuste-quantidade').value;
        dados.unidade = document.getElementById('ft-padrao-ajuste-unidade').value;
      }
    }
    const ajusteId = form.dataset.ajusteId;
    const url = `/fabrica-loja/fichas-padrao/vinculos/${estado.vinculoAjustesId}/ajustes${ajusteId ? `/${ajusteId}` : ''}`;
    executarMutacao(botao, ftApi(ajusteId ? 'PUT' : 'POST', url, dados), (data) =>
      entidade(data, 'ajuste', (item) => item.operacao === operacao, 'O servidor não confirmou o ajuste solicitado.'),
    () => {
      estado.ajusteEditandoId = null;
      abrirAjustes(estado.vinculoAjustesId);
      if (typeof showNotification === 'function') showNotification('Ajuste salvo.', 'success');
    }, 'Não foi possível salvar o ajuste.').always(() => { form.dataset.ftBusy = '0'; });
  });

  carregarLista();
}

function ftPadraoEstadoAtualizacao(estado) {
  const nomes = {
    ATUALIZADO: 'Atualizado',
    PENDENTE: 'Pendente de decisão',
    APROVADO: 'Aprovado',
    MANTER_ANTERIOR: 'Versão anterior mantida',
    SUPERADA: 'Atualização superada'
  };
  return nomes[estado] || estado || 'Estado não informado';
}

function ftPadraoRenderLista(fichas) {
  const corpo = document.getElementById('ft-padrao-tbody');
  if (!corpo) return;
  if (!fichas.length) {
    corpo.innerHTML = '<tr><td colspan="6" class="text-muted">Nenhuma ficha por sabor cadastrada.</td></tr>';
    return;
  }
  corpo.innerHTML = fichas.map((ficha) => `
    <tr>
      <td>${ftEsc(ficha.codigo)}</td>
      <td>${ftEsc(ficha.nome)}</td>
      <td>${ficha.tipo === 'SABOR'
        ? `${ftEsc(ficha.ficha_tradicional_codigo || '')} — ${ftEsc(ficha.ficha_tradicional_nome || '')}${ficha.atualizacao_origem_disponivel ? ' · Nova origem disponível' : ''}`
        : '<span class="text-warning">Cadastro legado sem origem</span>'}</td>
      <td>${ficha.ativa ? 'Ativa' : 'Inativa'}</td>
      <td>${ficha.ultima_versao == null ? 'Sem versão publicada' : `v${ftEsc(ficha.ultima_versao)}`}</td>
      <td class="text-nowrap">
        <button type="button" class="btn btn-outline-primary btn-sm" data-ft-padrao-acao="abrir-ficha" data-ficha-id="${ftEsc(ficha.id)}">Abrir (${ftEsc(ficha.produtos_vinculados)} produtos)</button>
        <button type="button" class="btn btn-outline-warning btn-sm" data-ft-padrao-acao="alternar-status" data-ficha-id="${ftEsc(ficha.id)}" data-ativa="${ficha.ativa ? '1' : '0'}">${ficha.ativa ? 'Inativar' : 'Ativar'}</button>
        <button type="button" class="btn btn-outline-danger btn-sm" data-ft-padrao-acao="excluir-ficha" data-ficha-id="${ftEsc(ficha.id)}" data-ficha-tipo="${ftEsc(ficha.tipo)}" ${ficha.tipo !== 'SABOR' && Number(ficha.vinculos_existentes) > 0 ? 'disabled title="Os vínculos existentes impedem a exclusão."' : ''}>Excluir</button>
      </td>
    </tr>`).join('');
}

function ftPadraoHtmlAjustes(ajustes, componentes, editavel) {
  if (!ajustes.length) return '<p class="text-muted">Este produto não possui ajustes específicos; os componentes permanecem herdados da versão atual.</p>';
  return `
    <div class="table-responsive">
      <table class="table table-sm align-middle">
        <thead><tr><th>Componente</th><th>Operação</th><th>Quantidade</th><th>Unidade</th><th>Justificativa</th><th>Ações</th></tr></thead>
        <tbody>${ajustes.map((ajuste) => {
          const base = (componentes || []).find((item) => Number(item.componente_base_id) === Number(ajuste.componente_base_id));
          const nome = ajuste.operacao === 'ADICIONAR'
            ? `Insumo #${ajuste.produto_id}`
            : base ? base.descricao : `Componente #${ajuste.componente_base_id}`;
          return `<tr>
            <td>${ftEsc(nome)}</td><td>${ftEsc(ajuste.operacao)}</td>
            <td>${ajuste.quantidade == null ? '—' : ftEsc(ajuste.quantidade)}</td><td>${ftEsc(ajuste.unidade || '—')}</td>
            <td>${ftEsc(ajuste.justificativa || '—')}</td>
            <td class="text-nowrap">${editavel ? `<button type="button" class="btn btn-link btn-sm" data-ft-padrao-acao="editar-ajuste" data-ajuste-id="${ftEsc(ajuste.id)}">Editar</button><button type="button" class="btn btn-link btn-sm text-danger" data-ft-padrao-acao="remover-ajuste" data-ajuste-id="${ftEsc(ajuste.id)}">Remover</button>` : 'Somente consulta'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

function ftPadraoColetarComponentes(form) {
  const componentes = [];
  const vistos = new Set();
  form.querySelectorAll('#ft-padrao-componentes [data-ft-linha]').forEach((linha) => {
    const componente = {
      produto_id: ftCampo(linha, 'produto_id').trim(),
      quantidade: ftCampo(linha, 'quantidade').trim(),
      unidade: ftCampo(linha, 'unidade').trim(),
      observacao: ftCampo(linha, 'observacao').trim()
    };
    if (!componente.produto_id && !componente.quantidade && !componente.unidade && !componente.observacao) return;
    if (!componente.produto_id || !componente.quantidade || !componente.unidade) {
      throw new Error('Cada componente deve ter um insumo selecionado, quantidade e unidade.');
    }
    if (vistos.has(componente.produto_id)) throw new Error('O mesmo insumo não pode aparecer duas vezes na versão.');
    vistos.add(componente.produto_id);
    componentes.push(componente);
  });
  return componentes;
}

function ftPadraoColetarEtapas(form) {
  const etapas = [];
  form.querySelectorAll('#ft-padrao-etapas [data-ft-linha]').forEach((linha) => {
    const etapa = {
      titulo: ftCampo(linha, 'titulo').trim(),
      descricao: ftCampo(linha, 'descricao').trim(),
      tempo_minutos: ftCampo(linha, 'tempo_minutos').trim(),
      observacao: ftCampo(linha, 'observacao').trim()
    };
    if (!etapa.titulo && !etapa.descricao && !etapa.tempo_minutos && !etapa.observacao) return;
    if (!etapa.titulo) throw new Error('Informe o título de cada etapa preenchida.');
    etapas.push(etapa);
  });
  return etapas;
}

function ftPadraoColetarInformacoes(form) {
  const informacoes = [];
  form.querySelectorAll('#ft-padrao-informacoes [data-ft-linha]').forEach((linha) => {
    const informacao = {
      titulo: ftCampo(linha, 'titulo').trim(),
      valor: ftCampo(linha, 'valor').trim()
    };
    if (!informacao.titulo && !informacao.valor) return;
    if (!informacao.titulo) throw new Error('Informe o título de cada informação preenchida.');
    informacoes.push(informacao);
  });
  return informacoes;
}

function loadFichasTecnicas() {
  $('#page-content').html(`
    <div class="container mt-4 ft-pagina">
      <div class="nav nav-tabs mb-3" role="tablist" aria-label="Tipo de ficha técnica">
        <button type="button" class="nav-link active" role="tab" aria-selected="true" aria-controls="ft-area-legada" data-ft-tab="legada">Fichas tradicionais</button>
        <button type="button" class="nav-link" role="tab" aria-selected="false" aria-controls="ft-area-padrao" data-ft-tab="padrao">Fichas por sabor</button>
      </div>
      <section id="ft-area-legada" role="tabpanel">
      <div id="ft-lista-painel">
        <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
          <div>
            <h2 class="mb-1">Fichas Técnicas</h2>
            <p class="ft-aviso mb-0">A ficha tradicional é a origem dos dados herdados. Para produção, vincule e aprove uma ficha por sabor no cadastro do produto.</p>
          </div>
          <button type="button" class="btn btn-success" id="ft-nova">Nova ficha</button>
        </div>
        <div class="d-flex gap-3 align-items-end flex-wrap mb-3">
          <div>
            <label class="form-label mb-1" for="ft-busca">Buscar</label>
            <input class="form-control" id="ft-busca" placeholder="Nome ou código" autocomplete="off">
          </div>
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" id="ft-incluir-inativas">
            <label class="form-check-label" for="ft-incluir-inativas">Mostrar inativas</label>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-bordered table-hover align-middle">
            <thead>
              <tr>
                <th>Código</th>
                <th>Ficha</th>
                <th>Componentes</th>
                <th>Etapas</th>
                <th>Informações</th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="ft-tbody">
              <tr><td colspan="7" class="text-muted">Carregando...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div id="ft-editor" hidden></div>
      </section>
      <section id="ft-area-padrao" role="tabpanel" hidden>
        <div id="ft-padrao-erro" class="alert alert-danger" role="alert" hidden></div>
        <div id="ft-padrao-lista">
          <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
            <div>
              <h2 class="h4 mb-1">Fichas por sabor</h2>
              <p class="ft-aviso mb-0">Selecione uma ficha tradicional para herdar composição, rendimento, etapas, informações e observações; personalize e publique sem alterar a origem.</p>
            </div>
            <button type="button" class="btn btn-success" data-ft-padrao-acao="nova-ficha">Nova ficha por sabor</button>
          </div>
          <div class="d-flex gap-3 align-items-end flex-wrap mb-3">
            <div>
              <label class="form-label mb-1" for="ft-padrao-busca">Buscar</label>
              <input class="form-control" id="ft-padrao-busca" placeholder="Sabor, código ou ficha tradicional" autocomplete="off">
            </div>
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" id="ft-padrao-inativas">
              <label class="form-check-label" for="ft-padrao-inativas">Mostrar inativas</label>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-bordered table-hover align-middle">
              <thead><tr><th>Código</th><th>Sabor</th><th>Ficha tradicional de origem</th><th>Situação</th><th>Última versão publicada</th><th></th></tr></thead>
              <tbody id="ft-padrao-tbody" aria-live="polite"><tr><td colspan="6" class="text-muted">Carregando fichas por sabor...</td></tr></tbody>
            </table>
          </div>
        </div>
        <div id="ft-padrao-detalhe" hidden></div>
        <div id="ft-padrao-editor" hidden></div>
        <div id="ft-padrao-ajustes" hidden></div>
      </section>
    </div>
  `);

  const pagina = document.querySelector('.ft-pagina');
  pagina.addEventListener('click', (evento) => {
    const alvo = evento.target;
    if (alvo.id === 'ft-nova') {
      ftAbrirEditor(null);
      return;
    }
    if (alvo.id === 'ft-cancelar') {
      ftFecharEditor();
      return;
    }
    const alterarStatus = alvo.closest('[data-ft-status]');
    if (alterarStatus) {
      const id = alterarStatus.getAttribute('data-ft-status');
      const ativa = alterarStatus.dataset.ativa !== '1';
      const verbo = ativa ? 'ativar' : 'inativar';
      const impacto = ativa
        ? 'A ficha voltará a ficar disponível para uso.'
        : 'A ficha deixará de ficar disponível, mas seu vínculo com o produto será preservado.';
      if (!window.confirm(`Confirmar ${verbo} esta ficha técnica? ${impacto}`)) return;
      alterarStatus.disabled = true;
      ftApi('PATCH', `/fabrica-loja/fichas/${id}/status`, { ativa })
        .done((resposta) => {
          if (!resposta || resposta.success !== true || !resposta.ficha || resposta.ficha.ativa !== ativa) {
            if (typeof showNotification === 'function') showNotification('O servidor não confirmou a alteração da situação.', 'error');
            return;
          }
          ftCarregarLista();
          if (typeof showNotification === 'function') showNotification(`Ficha técnica ${ativa ? 'ativada' : 'inativada'}.`, 'success');
        })
        .fail((err) => {
          if (typeof showNotification === 'function') showNotification(ftErro(err, 'Não foi possível alterar a situação da ficha.'), 'error');
        })
        .always(() => { if (alterarStatus.isConnected) alterarStatus.disabled = false; });
      return;
    }
    const excluir = alvo.closest('[data-ft-excluir]');
    if (excluir) {
      const id = excluir.getAttribute('data-ft-excluir');
      if (!window.confirm('Excluir esta ficha técnica definitivamente?')) return;
      excluir.disabled = true;
      ftApi('DELETE', `/fabrica-loja/fichas/${id}`)
        .done((resposta) => {
          if (!resposta || resposta.success !== true || resposta.removida !== true) {
            if (typeof showNotification === 'function') showNotification('O servidor não confirmou a exclusão da ficha técnica.', 'error');
            return;
          }
          ftCarregarLista();
          if (typeof showNotification === 'function') showNotification('Ficha técnica excluída.', 'success');
        })
        .fail((err) => {
          if (typeof showNotification === 'function') showNotification(ftErro(err, 'Não foi possível excluir a ficha técnica.'), 'error');
        })
        .always(() => { if (excluir.isConnected) excluir.disabled = false; });
      return;
    }
    const abrir = alvo.closest('[data-ft-abrir]');
    if (abrir) {
      ftApi('GET', '/fabrica-loja/fichas/' + abrir.getAttribute('data-ft-abrir'))
        .done((resposta) => ftAbrirEditor(resposta.ficha))
        .fail((err) => showNotification(ftErro(err, 'Não foi possível abrir a ficha.'), 'error'));
      return;
    }
    const adicionar = alvo.closest('[data-ft-adicionar]');
    if (adicionar) {
      const tipo = adicionar.getAttribute('data-ft-adicionar');
      const mapa = {
        componente: ['#ft-componentes', ftHtmlLinhaComponente],
        etapa: ['#ft-etapas', ftHtmlLinhaEtapa],
        informacao: ['#ft-informacoes', ftHtmlLinhaInformacao]
      };
      const par = mapa[tipo];
      if (par) document.querySelector(par[0]).insertAdjacentHTML('beforeend', par[1]({}));
      return;
    }
    const sugerir = alvo.closest('[data-ft-sugerir]');
    if (sugerir) {
      ftAplicarInsumo(sugerir.closest('[data-ft-linha]'), {
        id: sugerir.getAttribute('data-id'),
        nome: sugerir.getAttribute('data-nome'),
        codigo: sugerir.getAttribute('data-codigo'),
        unidade: sugerir.getAttribute('data-unidade')
      });
      return;
    }
    if (alvo.closest('[data-ft-limpar]')) {
      const linha = alvo.closest('[data-ft-linha]');
      const busca = linha.querySelector('.ft-busca');
      linha.querySelector('[data-campo="produto_id"]').value = '';
      linha.querySelector('[data-campo="descricao"]').value = linha.getAttribute('data-legado') || '';
      busca.querySelectorAll('.ft-selecionado, .ft-sugestoes').forEach((no) => no.remove());
      busca.insertAdjacentHTML('beforeend', ftHtmlBuscaInsumo({
        texto_legado: linha.getAttribute('data-legado') || ''
      }));
      return;
    }
    if (alvo.closest('[data-ft-remover]')) {
      const linha = alvo.closest('[data-ft-linha]');
      const grupo = linha && linha.parentElement;
      if (linha) linha.remove();
      if (grupo && !grupo.querySelector('[data-ft-linha]')) {
        if (grupo.id === 'ft-componentes') grupo.insertAdjacentHTML('beforeend', ftHtmlLinhaComponente({}));
        if (grupo.id === 'ft-etapas') grupo.insertAdjacentHTML('beforeend', ftHtmlLinhaEtapa({}));
        if (grupo.id === 'ft-informacoes') grupo.insertAdjacentHTML('beforeend', ftHtmlLinhaInformacao({}));
      }
      return;
    }
    if (alvo.id === 'ft-inativar') {
      const id = document.getElementById('ft-id').value;
      const dados = ftColetar();
      dados.ativa = false;
      alvo.disabled = true;
      ftApi('PUT', '/fabrica-loja/fichas/' + id, dados)
        .done(() => {
          ftFecharEditor();
          ftCarregarLista();
          showNotification('Ficha técnica inativada.', 'success');
        })
        .fail((err) => {
          alvo.disabled = false;
          ftMostrarErro(ftErro(err, 'Não foi possível inativar a ficha.'));
        });
    }
  });

  pagina.addEventListener('submit', (evento) => {
    const form = evento.target;
    if (!form || form.id !== 'ft-form') return;
    evento.preventDefault();
    const botao = document.getElementById('ft-salvar');
    const id = document.getElementById('ft-id').value;
    const dados = ftColetar();
    const semInsumo = (dados.componentes || []).some((item) => {
      const preenchido = item.produto_id || item.descricao || item.quantidade || item.unidade || item.observacao;
      return preenchido && !item.produto_id;
    });
    if (semInsumo) {
      ftMostrarErro('Selecione um insumo cadastrado para este componente.');
      return;
    }
    botao.disabled = true;
    const pedido = id
      ? ftApi('PUT', '/fabrica-loja/fichas/' + id, dados)
      : ftApi('POST', '/fabrica-loja/fichas', dados);
    pedido.done(() => {
      ftFecharEditor();
      ftCarregarLista();
      showNotification('Ficha técnica salva.', 'success');
    }).fail((err) => {
      botao.disabled = false;
      ftMostrarErro(ftErro(err, 'Não foi possível salvar a ficha técnica.'));
    });
  });

  pagina.addEventListener('input', (evento) => {
    const alvo = evento.target;
    if (alvo.id === 'ft-busca') {
      clearTimeout(pagina._ftBusca);
      pagina._ftBusca = setTimeout(ftCarregarLista, 250);
      return;
    }
    if (alvo.dataset.campo === 'busca' && alvo.closest('[data-ft-linha="componente"]')) {
      const linha = alvo.closest('[data-ft-linha]');
      clearTimeout(linha._ftProduto);
      linha._ftProduto = setTimeout(() => {
        ftBuscarInsumo(alvo.value, alvo.parentElement, (produto) => ftAplicarInsumo(linha, produto));
      }, 250);
    }
  });

  pagina.addEventListener('change', (evento) => {
    if (evento.target.id === 'ft-incluir-inativas') ftCarregarLista();
  });

  ftPadraoInit(pagina);
  ftCarregarLista();
  const pendente = Number(window._ftAbrirId);
  if (pendente) {
    window._ftAbrirId = null;
    ftApi('GET', '/fabrica-loja/fichas/' + pendente)
      .done((resposta) => ftAbrirEditor(resposta && resposta.ficha));
  }
}
