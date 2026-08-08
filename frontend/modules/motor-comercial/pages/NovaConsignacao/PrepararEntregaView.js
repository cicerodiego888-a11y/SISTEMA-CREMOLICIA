/**
 * Preparar Entrega — interface operacional UX-04.
 *
 * @module frontend/modules/motor-comercial/pages/NovaConsignacao/PrepararEntregaView
 */

const Button = require('../../components/base/Button');
const Input = require('../../components/form/Input');
const Textarea = require('../../components/form/Textarea');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const {
  buildPainelResumo,
  buildValidacoesConferencia,
  buildClienteResumo,
  buildConferenciaResumo,
  formatCurrency,
  formatOrigemPreco,
  rotuloLinhaItem,
  rotuloTabelaItem
} = require('./prepararEntregaMappers');

class PrepararEntregaView {
  static renderMomento(momento, state, ctx) {
    switch (momento) {
      case 'cliente':
        return PrepararEntregaView.renderCliente(state, ctx);
      case 'produtos':
        return PrepararEntregaView.renderProdutos(state, ctx);
      case 'conferencia':
        return PrepararEntregaView.renderConferencia(state, ctx);
      case 'conclusao':
        return PrepararEntregaView.renderConclusao(state, ctx);
      default:
        return document.createElement('div');
    }
  }

  static renderCliente(state, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-preparar-entrega__momento';

    if (state.skipClienteStep && state.clienteLocked && state.clienteProfile) {
      wrap.appendChild(PrepararEntregaView._renderClientePainel(state, ctx, { locked: true }));
      return wrap;
    }

    const title = document.createElement('h2');
    title.className = 'cds-preparar-entrega__titulo';
    title.textContent = 'Selecione o Cliente';
    wrap.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'cds-preparar-entrega__hint';
    hint.textContent = 'Pesquise por nome, telefone, CPF, código ou documento';
    wrap.appendChild(hint);

    const searchRow = document.createElement('div');
    searchRow.className = 'cds-preparar-entrega__busca';

    const searchField = Input.create({
      placeholder: 'Digite para pesquisar...',
      id: 'prep-cliente-busca',
      value: state.clienteBusca || ''
    });
    const input = searchField.querySelector('input');
    if (input) {
      input.autocomplete = 'off';
      input.addEventListener('input', (e) => ctx.onClienteBuscaChange(e.target.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          ctx.onClienteBuscaSubmit(e.target.value);
        }
      });
      setTimeout(() => input.focus(), 0);
    }
    searchRow.appendChild(searchField);
    wrap.appendChild(searchRow);

    const resultsHost = document.createElement('div');
    resultsHost.className = 'cds-preparar-entrega__resultados';
    resultsHost.id = 'prep-cliente-resultados';

    if (state.loading.profile) {
      resultsHost.appendChild(Loading.create({ message: 'Buscando clientes...' }));
    } else if (state.clienteResultados?.length) {
      state.clienteResultados.forEach((cliente) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'cds-preparar-entrega__resultado-item';
        row.innerHTML = `
          <strong>${cliente.nome}</strong>
          <span>${cliente.cpf_cnpj || cliente.documento || '—'}</span>
          <span>${cliente.telefone || '—'}</span>
          <span>${cliente.cidade || cliente.municipio || '—'}</span>
        `;
        row.addEventListener('click', () => ctx.onClienteSelecionado(cliente));
        resultsHost.appendChild(row);
      });
    } else if (state.clienteProfile) {
      resultsHost.appendChild(PrepararEntregaView._renderClientePainel(state, ctx, { locked: false }));
    } else {
      resultsHost.appendChild(EmptyState.create({
        title: 'Nenhum cliente selecionado',
        description: 'Digite na pesquisa para localizar o cliente'
      }));
    }

    wrap.appendChild(resultsHost);
    return wrap;
  }

  static _renderClientePainel(state, ctx, { locked = false } = {}) {
    const panel = document.createElement('div');
    panel.className = 'cds-preparar-entrega__cliente-painel';

    const grid = document.createElement('div');
    grid.className = 'cds-preparar-entrega__cliente-grid';

    buildClienteResumo(state.clienteProfile).forEach((field) => {
      const cell = document.createElement('div');
      cell.className = 'cds-preparar-entrega__cliente-campo';
      cell.innerHTML = `<label>${field.label}</label><strong>${field.value}</strong>`;
      grid.appendChild(cell);
    });

    panel.appendChild(grid);

    if (locked) {
      const actions = document.createElement('div');
      actions.className = 'cds-preparar-entrega__cliente-acoes';
      actions.appendChild(Button.create({
        text: 'Trocar Cliente',
        variant: 'ghost',
        onClick: () => ctx.onTrocarCliente()
      }));
      panel.appendChild(actions);
    }

    return panel;
  }

  static renderProdutos(state, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-preparar-entrega__momento cds-preparar-entrega__momento--produtos';

    if (state.clienteProfile) {
      if (state.skipClienteStep && state.clienteLocked) {
        wrap.appendChild(PrepararEntregaView._renderClientePainel(state, ctx, { locked: true }));
      } else {
        const clienteBar = document.createElement('div');
        clienteBar.className = 'cds-preparar-entrega__cliente-bar';
        clienteBar.innerHTML = `<span><strong>${state.clienteProfile.nome}</strong></span>`;
        wrap.appendChild(clienteBar);
      }
    }

    const lipHost = document.createElement('div');
    lipHost.className = 'cds-preparar-entrega__lip';
    lipHost.id = 'lip-host';
    wrap.appendChild(lipHost);

    const lipSimHost = document.createElement('div');
    lipSimHost.className = 'cds-preparar-entrega__lip-simulacao';
    lipSimHost.id = 'lip-simulacao';
    lipSimHost.hidden = true;
    wrap.appendChild(lipSimHost);

    wrap.appendChild(PrepararEntregaView._renderAtalhosTeclado());

    const gradeHost = document.createElement('div');
    gradeHost.className = 'cds-preparar-entrega__grade';
    gradeHost.id = 'prep-itens-grade';

    if (!state.data.itens.length) {
      gradeHost.appendChild(EmptyState.create({
        title: 'Nenhum produto adicionado',
        description: 'Use a pesquisa acima para incluir produtos na entrega'
      }));
    } else {
      gradeHost.appendChild(PrepararEntregaView._renderGradeItens(state, ctx));
    }

    wrap.appendChild(gradeHost);
    return wrap;
  }

  static _renderAtalhosTeclado() {
    const bar = document.createElement('div');
    bar.className = 'cds-preparar-entrega__atalhos';
    bar.innerHTML = `
      <span><kbd>ENTER</kbd> Confirma produto</span>
      <span><kbd>TAB</kbd> Próximo campo</span>
      <span><kbd>ESC</kbd> Cancela pesquisa</span>
      <span><kbd>Ctrl</kbd>+<kbd>DEL</kbd> Remove item</span>
      <span><kbd>F2</kbd> Editar quantidade</span>
    `;
    return bar;
  }

  static _renderGradeItens(state, ctx) {
    const table = document.createElement('div');
    table.className = 'cds-preparar-entrega__grade-tabela cds-preparar-entrega__grade-tabela--snapshot';

    const head = document.createElement('div');
    head.className = 'cds-preparar-entrega__grade-head';
    head.innerHTML = `
      <span>Produto</span>
      <span>Qtd</span>
      <span>Preço</span>
      <span>Total</span>
      <span>Obs.</span>
      <span></span>
    `;
    table.appendChild(head);

    const tabelaOp = state.operacaoResumo?.tabelaPreco || null;

    state.data.itens.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `cds-preparar-entrega__grade-row${state.focusedItemIndex === index ? ' cds-preparar-entrega__grade-row--focus' : ''}`;
      row.dataset.index = String(index);

      const prodCell = document.createElement('div');
      prodCell.className = 'cds-preparar-entrega__grade-produto';
      prodCell.innerHTML = `
        <strong>${item.produto}</strong>
        ${item.codigo ? `<small>${item.codigo}</small>` : ''}
        ${PrepararEntregaView._htmlSnapshotItem(item, tabelaOp)}
      `;
      row.appendChild(prodCell);

      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '1';
      qtyInput.step = '1';
      qtyInput.value = String(item.quantidade || 1);
      qtyInput.className = 'cds-preparar-entrega__qty-input';
      qtyInput.dataset.qtyIndex = String(index);
      qtyInput.addEventListener('focus', () => ctx.onItemFocus(index));
      qtyInput.addEventListener('input', () => {
        if (typeof ctx.onItemQtyInput === 'function') {
          ctx.onItemQtyInput(index, qtyInput.value);
        }
      });
      qtyInput.addEventListener('change', () => ctx.onItemQtyChange(index, qtyInput.value));
      row.appendChild(qtyInput);

      const precoCell = document.createElement('div');
      precoCell.className = 'cds-preparar-entrega__grade-preco';
      const ucLabel = item.unidadeComercial ? ` / ${item.unidadeComercial}` : '';
      precoCell.innerHTML = `
        <span>${formatCurrency(item.preco)}${ucLabel}</span>
        ${item.precoFallback
          ? '<small class="cds-preparar-entrega__preco-seguranca">Utilizando Preço de Segurança</small>'
          : ''}
      `;
      row.appendChild(precoCell);

      const total = document.createElement('span');
      total.className = 'cds-preparar-entrega__grade-total';
      total.textContent = formatCurrency((item.quantidade || 0) * (item.preco || 0));
      row.appendChild(total);

      const obsInput = document.createElement('input');
      obsInput.type = 'text';
      obsInput.placeholder = 'Obs.';
      obsInput.value = item.observacao || '';
      obsInput.className = 'cds-preparar-entrega__obs-input';
      obsInput.addEventListener('change', () => ctx.onItemObsChange(index, obsInput.value));
      row.appendChild(obsInput);

      const actions = document.createElement('div');
      actions.className = 'cds-preparar-entrega__grade-acoes';
      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.className = 'cds-preparar-entrega__icon-btn';
      dupBtn.title = 'Duplicar';
      dupBtn.textContent = '⧉';
      dupBtn.addEventListener('click', () => ctx.onItemDuplicar(index));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'cds-preparar-entrega__icon-btn cds-preparar-entrega__icon-btn--danger';
      delBtn.title = 'Remover';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => ctx.onItemRemover(index));
      actions.appendChild(dupBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);

      table.appendChild(row);
    });

    // RCM-8.5 — Detalhes / Comparar Tabelas
    table.addEventListener('click', (ev) => {
      const detalheBtn = ev.target.closest('.cds-btn-detalhe-precificacao');
      const compararBtn = ev.target.closest('.cds-btn-comparar-tabelas');
      if (!detalheBtn && !compararBtn) return;
      ev.preventDefault();
      const idx = Number(
        (detalheBtn || compararBtn).closest('.cds-preparar-entrega__grade-row')?.dataset?.index
      );
      const item = state.data.itens[idx];
      if (!item) return;
      if (detalheBtn) {
        PrepararEntregaView.abrirDetalhesPrecificacao(item, 'CONSIGNADO');
        return;
      }
      const pid = Number(compararBtn.dataset.produtoId || item.produtoId);
      if (typeof ctx.onCompararTabelas === 'function') {
        ctx.onCompararTabelas(pid, item);
      } else if (ctx.api) {
        PrepararEntregaView.abrirCompararTabelas(ctx.api, pid, item);
      }
    });

    return table;
  }

  /** Snapshot discreto da precificação (RCM-6.1 / RCM-7.5 / RCM-8.5) */
  static _htmlSnapshotItem(item, tabelaOp = null) {
    const linha = rotuloLinhaItem(item);
    const tabela = rotuloTabelaItem(item, tabelaOp);
    const uc = item.unidadeComercial || '—';
    const origem = formatOrigemPreco(item.precoOrigem, !!item.precoFallback);
    return `
      <div class="cds-item-snapshot" aria-label="Snapshot da precificação">
        <span><em>Linha de Precificação</em> ${linha}</span>
        <span><em>Tabela de Preços</em> ${tabela}</span>
        <span><em>UC</em> ${uc}</span>
        <span><em>Origem</em> ${origem}</span>
        <span class="cds-item-snapshot__acoes">
          <button type="button" class="cds-link-btn cds-btn-detalhe-precificacao" data-produto-id="${item.produtoId || ''}">Detalhes</button>
          <button type="button" class="cds-link-btn cds-btn-comparar-tabelas" data-produto-id="${item.produtoId || ''}">Comparar Tabelas</button>
        </span>
      </div>
    `;
  }

  static abrirDetalhesPrecificacao(item, operacao = 'CONSIGNADO') {
    const linha = item.linhaComercialDescricao || item.linhaComercialCodigo
      || (item.linhaComercialId ? ('#' + item.linhaComercialId) : 'Produto sem Linha');
    const msg =
      'Detalhes da Precificação\n\n' +
      'Produto: ' + (item.produto || item.nome || '') + '\n' +
      'Tabela: ' + (item.tabelaPrecoNome || item.tabelaPrecoId || '—') + '\n' +
      'Linha: ' + linha + '\n' +
      'Unidade: ' + (item.unidadeComercial || '—') + '\n' +
      'Preço: ' + formatCurrency(Number(item.preco || item.precoUnitario || 0)) + '\n' +
      'Origem: ' + formatOrigemPreco(item.precoOrigem, !!item.precoFallback) + '\n' +
      'Operação: ' + operacao + '\n' +
      'Resolver: Motor Oficial';
    window.alert(msg);
  }

  static async abrirCompararTabelas(api, produtoId, item) {
    if (!api || !produtoId) {
      window.alert('Produto inválido para comparação.');
      return;
    }
    try {
      const res = await api.compararTabelasPrecificacao({ produtoId: Number(produtoId) });
      const linhas = (res.comparacoes || []).map((c) => {
        const preco = c.preco != null
          ? formatCurrency(Number(c.preco)) + ' / ' + (c.unidade_comercial || '')
          : '—';
        return (c.canal_nome || c.canal) + ': ' + preco;
      }).join('\n');
      window.alert(
        'Comparar Tabelas (informativo)\n\n' +
        'Produto: ' + ((res.produto && res.produto.nome) || (item && item.produto) || produtoId) + '\n' +
        'Tabela atual: ' + ((item && (item.tabelaPrecoNome || 'Consignação')) || 'Consignação') + '\n\n' +
        linhas +
        '\n\nNão altera a tabela da operação.'
      );
    } catch (err) {
      window.alert(err.message || 'Falha ao comparar tabelas');
    }
  }

  static renderConferencia(state, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-preparar-entrega__momento';

    const title = document.createElement('h2');
    title.className = 'cds-preparar-entrega__titulo';
    title.textContent = 'Conferência';
    wrap.appendChild(title);

    const painel = buildPainelResumo(state.data.itens, state.clienteProfile || {});
    const avisos = buildValidacoesConferencia(state.data, state.clienteProfile);

    if (avisos.length) {
      const alertBox = document.createElement('div');
      alertBox.className = 'cds-preparar-entrega__avisos';
      avisos.forEach((aviso) => {
        alertBox.appendChild(Alert.create({
          message: aviso.message,
          variant: aviso.nivel === 'danger' ? 'error' : 'warning',
          dismissible: false
        }));
      });
      wrap.appendChild(alertBox);
    }

    const resumo = document.createElement('div');
    resumo.className = 'cds-preparar-entrega__conferencia-grid';
    buildConferenciaResumo(state.data, state.clienteProfile, painel).forEach((field) => {
      const cell = document.createElement('div');
      cell.className = `cds-preparar-entrega__conferencia-campo${field.highlight ? ' cds-preparar-entrega__conferencia-campo--destaque' : ''}`;
      cell.innerHTML = `<label>${field.label}</label><strong>${field.value}</strong>`;
      resumo.appendChild(cell);
    });
    wrap.appendChild(resumo);

    if (state.data.itens.length) {
      const tabelaOp = state.operacaoResumo?.tabelaPreco || null;
      const lista = document.createElement('div');
      lista.className = 'cds-preparar-entrega__conferencia-itens cds-preparar-entrega__conferencia-itens--snapshot';
      lista.innerHTML = `
        <div class="cds-preparar-entrega__conferencia-itens-head">
          <span>Produto</span>
          <span>Linha de Precificação</span>
          <span>Tabela de Preços</span>
          <span>UC</span>
          <span>Preço</span>
          <span>Origem</span>
          <span>Quantidade</span>
          <span>Total</span>
        </div>
      `;
      state.data.itens.forEach((item) => {
        const linha = document.createElement('div');
        linha.className = 'cds-preparar-entrega__conferencia-linha';
        const origem = formatOrigemPreco(item.precoOrigem, !!item.precoFallback);
        const fallbackHint = item.precoFallback
          ? '<small class="cds-preparar-entrega__preco-seguranca">Preço de Segurança</small>'
          : '';
        linha.innerHTML = `
          <span>${item.produto}${fallbackHint}</span>
          <span>${rotuloLinhaItem(item)}</span>
          <span>${rotuloTabelaItem(item, tabelaOp)}</span>
          <span>${item.unidadeComercial || '—'}</span>
          <span>${formatCurrency(item.preco)}</span>
          <span>${origem}</span>
          <span>${item.quantidade}</span>
          <span>${formatCurrency((item.quantidade || 0) * (item.preco || 0))}</span>
        `;
        lista.appendChild(linha);
      });
      wrap.appendChild(lista);
    }

    const extras = document.createElement('div');
    extras.className = 'cds-preparar-entrega__conferencia-extras';

    const docExt = document.createElement('div');
    docExt.className = 'cds-preparar-entrega__campo';
    docExt.innerHTML = '<label>Documento Externo (opcional)</label>';
    const docInput = Input.create({
      placeholder: 'Pedido, OC ou protocolo do cliente',
      value: state.data.documentoExterno || '',
      onChange: (v) => ctx.onDocumentoExternoChange(v)
    });
    docExt.appendChild(docInput);
    extras.appendChild(docExt);

    const obs = document.createElement('div');
    obs.className = 'cds-preparar-entrega__campo';
    obs.innerHTML = '<label>Observações</label>';
    obs.appendChild(Textarea.create({
      placeholder: 'Observações sobre a entrega',
      value: state.data.observacoes || '',
      onChange: (v) => ctx.onObservacoesChange(v)
    }));
    extras.appendChild(obs);

    wrap.appendChild(extras);
    return wrap;
  }

  static renderConclusao(state, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-preparar-entrega__momento cds-preparar-entrega__momento--conclusao';

    wrap.innerHTML = `
      <div class="cds-preparar-entrega__sucesso-icone">✓</div>
      <h2 class="cds-preparar-entrega__titulo">Consignação criada com sucesso</h2>
      <p class="cds-preparar-entrega__documento-label">Documento</p>
      <p class="cds-preparar-entrega__documento-numero">${state.documentoCriado || '—'}</p>
    `;

    const actions = document.createElement('div');
    actions.className = 'cds-preparar-entrega__conclusao-acoes';

    [
      { icon: '🖨', label: 'Imprimir Termo', acao: 'imprimir-termo' },
      { icon: '📄', label: 'Visualizar PDF', acao: 'visualizar-pdf' },
      { icon: '📦', label: 'Abrir Entrega', acao: 'abrir-entrega', destaque: true },
      { icon: '👤', label: state.voltarLabel || 'Voltar', acao: 'voltar', destaque: false }
    ].forEach((btn) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `cds-preparar-entrega__conclusao-btn${btn.destaque ? ' cds-preparar-entrega__conclusao-btn--destaque' : ''}`;
      el.innerHTML = `<span>${btn.icon}</span><span>${btn.label}</span>`;
      el.addEventListener('click', () => ctx.onConclusaoAcao(btn.acao));
      actions.appendChild(el);
    });

    wrap.appendChild(actions);
    return wrap;
  }

  static _classeDestaqueSaldo(destaque) {
    if (destaque === 'critico') return 'cds-preparar-entrega__destaque--critico';
    if (destaque === 'alerta') return 'cds-preparar-entrega__destaque--alerta';
    return '';
  }

  static renderLipSimulacao(simulacao) {
    const host = document.createElement('div');
    host.className = 'cds-preparar-entrega__lip-simulacao-inner';
    if (!simulacao) return host;

    const painel = simulacao.painelProjetado;
    host.innerHTML = `
      <div class="cds-preparar-entrega__lip-sim-titulo">Simulação da inclusão</div>
      <div class="cds-preparar-entrega__lip-sim-grid">
        <div><label>Produto</label><strong>${simulacao.produto}</strong></div>
        <div><label>Quantidade</label><strong>${simulacao.quantidade}</strong></div>
        <div><label>Valor da inclusão</label><strong>${simulacao.valorInclusaoExibicao}</strong></div>
        <div><label>Valor desta Entrega</label><strong>${formatCurrency(painel.valorTotal)}</strong></div>
        <div><label>Saldo após Entrega</label><strong>${painel.creditoAposEntregaExibicao || painel.creditoDisponivelExibicao}</strong></div>
        <div><label>Utilização</label><strong>${painel.percentualLimiteExibicao || painel.percentualUtilizadoTexto}</strong></div>
      </div>
    `;
    return host;
  }

  /**
   * RCM-7.5 — Resumo Financeiro único (substitui strip + painel lateral duplicados).
   */
  static renderResumoFinanceiro(painel = {}) {
    const box = document.createElement('div');
    box.className = 'cds-resumo-financeiro';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Resumo Financeiro');

    const pct = painel.percentualLimite != null
      ? Math.min(Math.max(Number(painel.percentualLimite), 0), 100)
      : 0;
    const pctLabel = painel.percentualLimiteExibicao || '—';
    const limite = Number(painel.limiteComercial) > 0
      ? formatCurrency(painel.limiteComercial)
      : (painel.creditoDisponivelExibicao || formatCurrency(painel.limiteDisponivel || 0));

    box.innerHTML = `
      <div class="cds-resumo-financeiro__titulo">Resumo Financeiro</div>
      <div class="cds-resumo-financeiro__grid">
        <div class="cds-resumo-financeiro__item">
          <span class="cds-resumo-financeiro__label">Limite Comercial</span>
          <strong class="cds-resumo-financeiro__value" data-fin-limite>${limite}</strong>
        </div>
        <div class="cds-resumo-financeiro__item">
          <span class="cds-resumo-financeiro__label">Valor desta Entrega</span>
          <strong class="cds-resumo-financeiro__value" data-fin-valor>${formatCurrency(painel.valorTotal || 0)}</strong>
        </div>
        <div class="cds-resumo-financeiro__item">
          <span class="cds-resumo-financeiro__label">Saldo após Entrega</span>
          <strong class="cds-resumo-financeiro__value" data-fin-saldo>${painel.saldoRestanteExibicao || '—'}</strong>
        </div>
        <div class="cds-resumo-financeiro__item cds-resumo-financeiro__item--utilizacao">
          <span class="cds-resumo-financeiro__label">Utilização <strong data-fin-pct>${pctLabel}</strong></span>
          <div class="cds-resumo-financeiro__bar" role="progressbar"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
            <div class="cds-resumo-financeiro__bar-fill cds-resumo-financeiro__bar-fill--${painel.faixaUtilizacao || 'neutro'}"
                 data-fin-fill style="width:${pct}%"></div>
          </div>
        </div>
      </div>
    `;
    return box;
  }

  static atualizarResumoFinanceiroDom(host, painel = {}) {
    if (!host) return;
    const limiteEl = host.querySelector('[data-fin-limite]');
    const valorEl = host.querySelector('[data-fin-valor]');
    const saldoEl = host.querySelector('[data-fin-saldo]');
    const pctEl = host.querySelector('[data-fin-pct]');
    const fillEl = host.querySelector('[data-fin-fill]');
    const barEl = host.querySelector('.cds-resumo-financeiro__bar');

    const limite = Number(painel.limiteComercial) > 0
      ? formatCurrency(painel.limiteComercial)
      : (painel.creditoDisponivelExibicao || formatCurrency(painel.limiteDisponivel || 0));
    const pct = painel.percentualLimite != null
      ? Math.min(Math.max(Number(painel.percentualLimite), 0), 100)
      : 0;

    if (limiteEl) limiteEl.textContent = limite;
    if (valorEl) valorEl.textContent = formatCurrency(painel.valorTotal || 0);
    if (saldoEl) saldoEl.textContent = painel.saldoRestanteExibicao || '—';
    if (pctEl) pctEl.textContent = painel.percentualLimiteExibicao || '—';
    if (fillEl) {
      fillEl.style.width = `${pct}%`;
      fillEl.className = `cds-resumo-financeiro__bar-fill cds-resumo-financeiro__bar-fill--${painel.faixaUtilizacao || 'neutro'}`;
    }
    if (barEl) barEl.setAttribute('aria-valuenow', String(pct));
  }
}

module.exports = PrepararEntregaView;
