/**
 * Painel operacional da fábrica.
 * Consulta e navega. Não produz, não transfere e não altera estoque.
 */

function pfEsc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pfData(valor) {
  const texto = String(valor || '');
  const data = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (!data) return texto;
  return data[3] + '/' + data[2] + '/' + data[1] + (data[4] ? ' ' + data[4] : '');
}

function pfNomeStatus(status) {
  const nomes = {
    ABERTA: 'Aberta',
    PARCIALMENTE_ATENDIDA: 'Parcialmente atendida',
    ATENDIDA: 'Atendida',
    CANCELADA: 'Cancelada',
    RASCUNHO: 'Rascunho',
    PLANEJADA: 'Planejada',
    EM_PRODUCAO: 'Em produção',
    CONCLUIDA: 'Concluída',
    CONFIRMADA: 'Confirmada'
  };
  return nomes[status] || status || '';
}

function pfApi(caminho) {
  return $.ajax({
    url: API_URL + caminho,
    method: 'GET',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  });
}

function pfErro(err, reserva) {
  const corpo = err && err.responseJSON;
  return (corpo && corpo.error) || reserva;
}

function pfIr(pagina) {
  if (typeof loadPage === 'function') loadPage(pagina);
}

function pfCard(rotulo, valor) {
  return `<div class="pf-card pf-indicador">
    <span class="text-muted small">${pfEsc(rotulo)}</span>
    <strong>${pfEsc(valor)}</strong>
  </div>`;
}

function pfContagem(rotulo, valor, acao) {
  const tag = acao ? 'button' : 'span';
  return `<${tag} ${acao ? 'type="button" ' : ''}class="pf-contagem" ${acao || ''}>
    <span>${pfEsc(rotulo)}</span><strong>${pfEsc(valor)}</strong>
  </${tag}>`;
}

function pfOcorrencia(codigo, produto, quantidade, status, acao, aviso) {
  return `<article class="pf-ocorrencia">
    <div class="pf-ocorrencia__cabecalho">
      <div><strong>${pfEsc(codigo)}</strong><span>${pfEsc(produto)}</span></div>
      <span class="pf-status">${pfEsc(pfNomeStatus(status))}</span>
    </div>
    <div class="pf-ocorrencia__quantidade">${quantidade}</div>
    ${aviso ? `<div class="pf-ocorrencia__aviso">${pfEsc(aviso)}</div>` : ''}
    ${acao}
  </article>`;
}

function pfHtml(painel) {
  const atual = painel || {};
  const resumo = atual.resumo || {};
  const estoque = atual.estoque_fabrica || {};
  const transferencias = atual.transferencias || {};
  const periodo = atual.periodo || 'hoje';
  const tituloProducao = periodo === 'hoje' ? 'hoje' : (periodo === '7' ? 'em 7 dias' : 'em 30 dias');
  const necessidades = (atual.necessidades_pendentes || []).map((item) => {
    const produto = item.produto_nome || item.descricao || 'Produto não informado pelo painel';
    const quantidade = `Solicitado: ${pfEsc(item.solicitado)} · Produzido: ${pfEsc(item.produzido)} · Restante: ${pfEsc(item.restante)}`;
    const origem = item.origem_nome ? `Origem: ${pfEsc(item.origem_nome)}` : '';
    return pfOcorrencia(
      item.codigo,
      produto,
      origem ? `${quantidade}<span>${origem}</span>` : quantidade,
      item.status,
      `<button type="button" class="btn btn-outline-secondary btn-sm" data-pf-necessidade="${pfEsc(item.id)}">Ver necessidade</button>`
    );
  }).join('');
  const ordens = (atual.ordens_pendentes || []).map((item) => {
    const planejada = item.status === 'PLANEJADA';
    const quantidade = `Planejado: ${pfEsc(item.planejado)}`;
    return pfOcorrencia(
      item.codigo,
      item.produto_nome || 'Produto não informado pelo painel',
      quantidade,
      item.status,
      `<button type="button" class="btn btn-outline-secondary btn-sm" data-pf-op="${pfEsc(item.id)}">Ver OP</button>`,
      planejada ? 'Falta iniciar a produção.' : ''
    );
  }).join('');
  const abaixo = (atual.ordens_abaixo || []).map((item) => pfOcorrencia(
    item.codigo,
    item.produto_nome || 'Produto não informado pelo painel',
    `Planejado: ${pfEsc(item.planejado)} · Produzido: ${pfEsc(item.produzido)} · Perdido: ${pfEsc(item.perdido)}`,
    item.status,
    `<button type="button" class="btn btn-outline-secondary btn-sm" data-pf-op="${pfEsc(item.id)}">Ver OP</button>`,
    'Produção abaixo do planejado.'
  )).join('');
  const rascunhos = (atual.transferencias_pendentes || []).map((item) => pfOcorrencia(
    item.codigo,
    item.produto_nome || `${pfEsc(item.itens)} produtos`,
    `Itens: ${pfEsc(item.itens)} · Origem: ${pfEsc(item.origem_local)} · Destino: ${pfEsc(item.destino_local)}`,
    item.status,
    `<button type="button" class="btn btn-outline-secondary btn-sm" data-pf-transferencia="${pfEsc(item.id)}" data-pf-continuar="1">Continuar</button>`
  )).join('');
  const ocorrencias = necessidades + ordens + abaixo + rascunhos;
  const resumoAtencoes = (atual.atencoes || []).map((item) => `<span>${pfEsc(item.texto)}</span>`).join('');
  const produtos = (atual.producao_produtos || []).map((item) => `<div class="d-flex justify-content-between gap-2"><span>${pfEsc(item.produto_nome)}</span><strong>${pfEsc(item.produzido)} ${pfEsc(item.unidade)}</strong></div>`).join('');
  const insumos = (estoque.itens_insumo || []).map((item) => `<div class="d-flex justify-content-between gap-2"><span>${pfEsc(item.produto_nome)}</span><span>${pfEsc(item.quantidade)} ${pfEsc(item.unidade)}</span></div>`).join('');
  const produzidos = (estoque.itens_produzido || []).map((item) => `<div class="d-flex justify-content-between gap-2"><span>${pfEsc(item.produto_nome)}</span><span>${pfEsc(item.quantidade)} ${pfEsc(item.unidade)}</span></div>`).join('');
  const recentes = (atual.transferencias_recentes || []).map((item) => `<article class="pf-linha">
    <div class="pf-linha__principal">
      <div><strong>${pfEsc(item.codigo)}</strong><span>${pfEsc(pfData(item.confirmada_em))}</span></div>
      <button type="button" class="btn btn-outline-secondary btn-sm" data-pf-transferencia="${pfEsc(item.id)}">Ver transferência</button>
    </div>
    <div>${pfEsc(item.produto_nome || '—')} ${item.quantidade == null ? '' : pfEsc(item.quantidade) + ' ' + pfEsc(item.unidade)}</div>
  </article>`).join('');
  const marca = (valor) => periodo === valor ? ' btn-primary' : ' btn-outline-primary';
  const classePeriodo = (valor) => periodo === valor ? 'true' : 'false';
  return `
    <div class="pf-cabecalho">
      <div>
        <h2 class="mb-1">Painel da Fábrica</h2>
        <p class="ft-aviso mb-0">Mostra o que precisa ser produzido, o que já foi produzido e o que falta transferir. Não altera estoque.</p>
      </div>
      <div class="pf-periodos" role="group" aria-label="Período do painel">
        <button type="button" class="btn btn-sm${marca('hoje')}" data-pf-periodo="hoje" aria-pressed="${classePeriodo('hoje')}">Hoje</button>
        <button type="button" class="btn btn-sm${marca('7')}" data-pf-periodo="7" aria-pressed="${classePeriodo('7')}">Últimos 7 dias</button>
        <button type="button" class="btn btn-sm${marca('30')}" data-pf-periodo="30" aria-pressed="${classePeriodo('30')}">Últimos 30 dias</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" id="pf-atualizar">Atualizar</button>
      </div>
    </div>
    <div class="pf-grade pf-indicadores" aria-label="Indicadores principais">
      ${pfCard('Necessidades abertas', resumo.necessidades_abertas || 0)}
      ${pfCard('Em andamento', resumo.ops_em_producao || 0)}
      ${pfCard('Produzido ' + tituloProducao, resumo.produzido || 0)}
    </div>
    <section class="pf-secao pf-secao--atencao${ocorrencias ? ' pf-secao--atencao-ativa' : ''}" aria-labelledby="pf-atencao-titulo">
      <h3 id="pf-atencao-titulo">Precisa de atenção</h3>
      ${resumoAtencoes ? `<div class="pf-resumo-atencao">${resumoAtencoes}</div>` : ''}
      ${ocorrencias
        ? `<div class="pf-ocorrencias">${ocorrencias}</div>`
        : '<p class="pf-sem-pendencias mb-0">Nenhuma pendência operacional.</p>'}
    </section>
    <section class="pf-secao pf-acesso" aria-labelledby="pf-acesso-titulo">
      <h3 id="pf-acesso-titulo">O que você deseja fazer?</h3>
      <div class="pf-acoes">
        <button type="button" class="btn btn-success" data-pf-acao="necessidade">Nova necessidade</button>
        <button type="button" class="btn btn-success" data-pf-acao="ordem">Nova ordem de produção</button>
        <button type="button" class="btn btn-success" data-pf-acao="transferencia">Transferir para Loja</button>
        <button type="button" class="btn btn-success" data-pf-acao="estoque">Consultar estoque</button>
      </div>
      <div class="pf-acoes-secundarias">
        <span>Outras ações:</span>
        <button type="button" class="btn btn-link btn-sm" data-pf-acao="produzir">Produzir uma necessidade</button>
        <button type="button" class="btn btn-link btn-sm" data-pf-acao="necessidades">Ver necessidades</button>
        <button type="button" class="btn btn-link btn-sm" data-pf-acao="ordens">Ver OPs</button>
      </div>
    </section>
    <section class="pf-secao pf-resumo-fabrica" aria-labelledby="pf-resumo-titulo">
      <h3 id="pf-resumo-titulo">Resumo da fábrica</h3>
      <div class="pf-resumo-grupos">
        <div class="pf-resumo-grupo">
          <h4>Necessidades</h4>
          <div class="pf-contagens">
            ${pfContagem('Abertas', resumo.necessidades_abertas || 0, 'data-pf-atendimento="ABERTA"')}
            ${pfContagem('Parciais', resumo.necessidades_parciais || 0, 'data-pf-atendimento="PARCIALMENTE_ATENDIDA"')}
            ${pfContagem('Atendidas', resumo.necessidades_atendidas || 0, 'data-pf-atendimento="ATENDIDA"')}
          </div>
        </div>
        <div class="pf-resumo-grupo">
          <h4>Ordens de produção</h4>
          <div class="pf-contagens">
            ${pfContagem('Rascunho', resumo.ops_rascunho || 0, 'data-pf-op-status="RASCUNHO"')}
            ${pfContagem('Planejada', resumo.ops_planejadas || 0, 'data-pf-op-status="PLANEJADA"')}
            ${pfContagem('Em produção', resumo.ops_em_producao || 0, 'data-pf-op-status="EM_PRODUCAO"')}
            ${pfContagem('Concluída', resumo.ops_concluidas || 0, 'data-pf-op-status="CONCLUIDA"')}
            ${pfContagem('Cancelada', resumo.ops_canceladas || 0, 'data-pf-op-status="CANCELADA"')}
          </div>
        </div>
        <div class="pf-resumo-grupo">
          <h4>Produção</h4>
          <div class="pf-contagens">
            ${pfContagem('Perdido ' + tituloProducao, resumo.perdido || 0)}
            ${pfContagem('Execuções', resumo.execucoes || 0)}
            ${pfContagem('OPs concluídas', resumo.ops_concluidas_periodo || 0)}
          </div>
          ${produtos ? `<div class="pf-lista-dados"><h5>Produção do período</h5>${produtos}</div>` : ''}
        </div>
        <div class="pf-resumo-grupo pf-resumo-grupo--estoque-transferencias">
          <h4>Estoque e transferências</h4>
          <div class="pf-estoques">
            <div class="pf-resumo-estoque">
              <h5>Insumos</h5>
              ${pfContagem('Com saldo na Fábrica', (estoque.insumos || 0) + ' itens')}
              ${insumos || '<div class="pf-estoque-vazio">Nenhum insumo com saldo na fábrica.</div>'}
            </div>
            <div class="pf-resumo-estoque">
              <h5>Produtos produzidos</h5>
              ${pfContagem('Com saldo na Fábrica', (estoque.produzidos || 0) + ' itens')}
              ${produzidos || '<div class="pf-estoque-vazio">Nenhum produto produzido com saldo na fábrica.</div>'}
            </div>
          </div>
          <div class="pf-resumo-transferencias">
            <h5>Transferências</h5>
            <div class="pf-contagens">
              ${pfContagem('Rascunhos', transferencias.rascunhos || 0)}
              ${pfContagem('Confirmadas', transferencias.confirmadas || 0)}
              ${pfContagem('Canceladas', transferencias.canceladas || 0)}
            </div>
          </div>
          ${recentes ? `<div class="pf-lista-dados"><h5>Transferido recentemente</h5><div class="pf-lista">${recentes}</div></div>` : ''}
        </div>
      </div>
    </section>`;
}

function pfCarregar(periodo) {
  const alvo = document.getElementById('pf-conteudo');
  if (!alvo) return;
  const escolhido = periodo || window._pfPeriodo || 'hoje';
  window._pfPeriodo = escolhido;
  alvo.innerHTML = '<div class="text-muted">Carregando...</div>';
  pfApi('/fabrica-loja/painel?periodo=' + encodeURIComponent(escolhido)).done((resposta) => {
    const painel = (resposta && resposta.painel) || {};
    window._pfPeriodo = painel.periodo || escolhido;
    if (document.getElementById('pf-conteudo')) document.getElementById('pf-conteudo').innerHTML = pfHtml(painel);
  }).fail((err) => {
    if (document.getElementById('pf-conteudo')) {
      document.getElementById('pf-conteudo').innerHTML = `<div class="alert alert-danger">${pfEsc(pfErro(err, 'Não foi possível carregar o painel.'))}</div>`;
    }
  });
}

function loadPainelFabrica() {
  $('#page-content').html(`
    <div class="container mt-4 ft-pagina pf-pagina">
      <div id="pf-conteudo"></div>
    </div>
  `);
  const pagina = document.querySelector('.ft-pagina');
  pagina.addEventListener('click', (evento) => {
    const alvo = (evento.target.closest && evento.target.closest('button')) || evento.target;
    if (alvo.id === 'pf-atualizar') {
      pfCarregar(window._pfPeriodo || 'hoje');
      return;
    }
    const periodo = alvo.getAttribute && alvo.getAttribute('data-pf-periodo');
    if (periodo) {
      pfCarregar(periodo);
      return;
    }
    const necessidade = alvo.getAttribute && alvo.getAttribute('data-pf-necessidade');
    if (necessidade) {
      window._npAbrirId = necessidade;
      pfIr('necessidades-producao');
      return;
    }
    const atendimento = alvo.getAttribute && alvo.getAttribute('data-pf-atendimento');
    if (atendimento) {
      window._npFiltroAtendimento = atendimento;
      pfIr('necessidades-producao');
      return;
    }
    const ordem = alvo.getAttribute && alvo.getAttribute('data-pf-op');
    if (ordem) {
      window._opAbrirId = ordem;
      pfIr('ordens-producao');
      return;
    }
    const statusOp = alvo.getAttribute && alvo.getAttribute('data-pf-op-status');
    if (statusOp) {
      window._opFiltroStatus = statusOp;
      pfIr('ordens-producao');
      return;
    }
    const transferencia = alvo.getAttribute && alvo.getAttribute('data-pf-transferencia');
    if (transferencia) {
      window._trfAbrirId = transferencia;
      window._trfEditar = alvo.getAttribute('data-pf-continuar') === '1';
      pfIr('transferencias');
      return;
    }
    const acao = alvo.getAttribute && alvo.getAttribute('data-pf-acao');
    if (acao === 'necessidade') {
      window._npNova = true;
      pfIr('necessidades-producao');
    } else if (acao === 'produzir') {
      pfIr('necessidades-producao');
    } else if (acao === 'ordem') {
      window._opNova = true;
      pfIr('ordens-producao');
    } else if (acao === 'transferencia') {
      window._trfNova = true;
      pfIr('transferencias');
    } else if (acao === 'necessidades') {
      pfIr('necessidades-producao');
    } else if (acao === 'ordens') {
      pfIr('ordens-producao');
    } else if (acao === 'estoque') {
      pfIr('produtos');
    }
  });
  pfCarregar(window._pfPeriodo || 'hoje');
}

window.loadPainelFabrica = loadPainelFabrica;
window.pfHtml = pfHtml;
