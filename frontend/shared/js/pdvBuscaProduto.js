(function (global) {
  'use strict';

  const LIMITE_RESULTADOS = 20;
  const DEBOUNCE_MS = 220;

  let resultados = [];
  let termoResultados = '';
  let avisoLista = '';
  let acaoSelecao = null;
  let indiceSelecionado = -1;
  let timerBusca = null;
  let requisicaoAtual = 0;
  let dropdownAberto = false;

  function obterInput() {
    return document.getElementById('buscaProdutoPdv');
  }

  function obterLista() {
    return document.getElementById('listaProdutosPdv');
  }

  function notificar(mensagem, tipo) {
    if (typeof global.showNotification === 'function') {
      global.showNotification(mensagem, tipo);
    }
  }

  function escapar(texto) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(texto ?? ''));
    return String(texto ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatarPrecoProduto(produto) {
    const temPromocao = produto?.tem_promocao === 1 || produto?.tem_promocao === true;
    const precoPromo = Number(produto?.preco_promocional || 0);
    const preco = Number(produto?.preco_venda || 0);
    const precoFinal = temPromocao && precoPromo > 0 ? precoPromo : preco;
    if (typeof global.formatCurrency === 'function') {
      return global.formatCurrency(precoFinal);
    }
    return `R$ ${precoFinal.toFixed(2)}`;
  }

  function obterModoFiscal() {
    if (typeof global.modoFiscalQueryParam === 'function') {
      return global.modoFiscalQueryParam();
    }
    return '0';
  }

  function ehExato(produto) {
    return produto?.match_exato === 1 || produto?.match_exato === true;
  }

  function resolverLocal(termo) {
    if (typeof global.resolverProdutoEntradaPdv === 'function') {
      return global.resolverProdutoEntradaPdv(termo);
    }
    return { status: 'NENHUM', produto: null, candidatos: [], balanca: null };
  }

  function rotuloIdentificadores(produto) {
    const partes = [];
    if (produto.codigo) partes.push(`Cód. ${produto.codigo}`);
    if (produto.codigo_barras) partes.push(produto.codigo_barras);
    return partes.join(' · ') || 'Sem código';
  }

  function estoqueDisponivel(produto) {
    if (typeof global.pdvEstoqueDisponivel === 'function') {
      return global.pdvEstoqueDisponivel(produto);
    }
    return Number(produto?.estoque_atual ?? produto?.estoque_exibido ?? 0);
  }

  function renderizarLista() {
    const lista = obterLista();
    if (!lista) return;

    if (!resultados.length) {
      dropdownAberto = false;
      lista.innerHTML = '<p class="vazio">Nenhum produto encontrado.</p>';
      lista.classList.remove('aberta');
      return;
    }

    dropdownAberto = true;
    lista.classList.add('aberta');

    const cabecalho = avisoLista
      ? `<p class="pdv-autocomplete-aviso">${escapar(avisoLista)}</p>`
      : '';

    lista.innerHTML = cabecalho + resultados.map((produto, index) => {
      const ativo = index === indiceSelecionado ? ' ativo' : '';
      const semEstoque = typeof global.pdvValidarEstoqueVenda === 'function'
        ? !global.pdvValidarEstoqueVenda(produto, 1).sucesso
        : estoqueDisponivel(produto) <= 0;
      const promocao = produto.tem_promocao === 1 || produto.tem_promocao === true;

      return `
        <button
          type="button"
          class="pdv-autocomplete-item${ativo}${semEstoque ? ' sem-estoque' : ''}"
          data-index="${index}"
          data-produto-id="${produto.id}"
          ${semEstoque ? 'disabled' : ''}
        >
          <span class="pdv-autocomplete-nome">${escapar(produto.nome || '-')}${promocao ? ' <small class="pdv-autocomplete-promo">PROMO</small>' : ''}</span>
          <span class="pdv-autocomplete-meta">
            <span class="pdv-autocomplete-codigo">${escapar(rotuloIdentificadores(produto))}</span>
            <strong class="pdv-autocomplete-preco">${formatarPrecoProduto(produto)}</strong>
          </span>
        </button>
      `;
    }).join('');
  }

  function definirResultados(termo, lista, opcoes = {}) {
    resultados = Array.isArray(lista) ? lista.slice(0, LIMITE_RESULTADOS) : [];
    termoResultados = termo;
    avisoLista = opcoes.aviso || '';
    acaoSelecao = typeof opcoes.aoSelecionar === 'function' ? opcoes.aoSelecionar : null;
    indiceSelecionado = Number.isInteger(opcoes.indice) ? opcoes.indice : -1;
    renderizarLista();
  }

  function obterIndiceDisponivel(inicio, direcao) {
    for (let index = inicio; index >= 0 && index < resultados.length; index += direcao) {
      const produto = resultados[index];
      const validacao = typeof global.pdvValidarEstoqueVenda === 'function'
        ? global.pdvValidarEstoqueVenda(produto, 1)
        : { sucesso: estoqueDisponivel(produto) > 0 };
      if (validacao?.sucesso) return index;
    }
    return -1;
  }

  function focarResultado(index) {
    if (index < 0) return;
    indiceSelecionado = index;
    renderizarLista();
    obterLista()?.querySelector(`[data-index="${index}"]`)?.focus();
  }

  function fecharLista(mensagem) {
    resultados = [];
    termoResultados = '';
    avisoLista = '';
    acaoSelecao = null;
    indiceSelecionado = -1;
    dropdownAberto = false;
    const lista = obterLista();
    if (lista) {
      lista.classList.remove('aberta');
      lista.innerHTML = `<p class="vazio">${escapar(mensagem || 'Digite para buscar por código ou nome...')}</p>`;
    }
  }

  function cancelarBuscaPendente() {
    clearTimeout(timerBusca);
    requisicaoAtual += 1;
  }

  function limparCampo() {
    const input = obterInput();
    if (input) input.value = '';
    fecharLista();
    if (typeof global.focarCampoCodigo === 'function') {
      global.focarCampoCodigo();
    }
  }

  function adicionarProdutoSelecionado(produto) {
    if (!produto) return;

    const acao = acaoSelecao;
    if (acao) {
      limparCampo();
      acao(produto);
      return;
    }

    if (typeof global.garantirProdutoDisponivelPdv === 'function') {
      global.garantirProdutoDisponivelPdv(produto);
    }

    if (typeof global.adicionarProdutoConsultaPDV !== 'function') {
      notificar('Não foi possível adicionar o produto selecionado.', 'danger');
      return;
    }
    global.adicionarProdutoConsultaPDV(produto.id);
    limparCampo();
  }

  /** Mostra produtos para o operador escolher; nada é adicionado sem seleção. */
  function mostrarCandidatos(termo, candidatos, opcoes = {}) {
    cancelarBuscaPendente();
    definirResultados(termo, candidatos, opcoes);
  }

  function urlBusca(termo) {
    const apiUrl = typeof API_URL !== 'undefined' ? API_URL : '/api';
    return `${apiUrl}/produtos/consulta-pdv/buscar?q=${encodeURIComponent(termo)}&modo_fiscal=${obterModoFiscal()}&limite=${LIMITE_RESULTADOS}`;
  }

  function consultarApi(termo) {
    return fetch(urlBusca(termo), {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`
      }
    }).then(async (response) => {
      const dados = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(dados?.error || 'Erro ao buscar produtos.');
      }
      return Array.isArray(dados) ? dados : [];
    });
  }

  /** Enter sem correspondência local: adiciona só se a API devolver exatamente um produto exato. */
  function resolverPelaApi(termo) {
    cancelarBuscaPendente();
    fecharLista('Buscando...');
    const reqId = requisicaoAtual;

    consultarApi(termo)
      .then((produtos) => {
        if (reqId !== requisicaoAtual) return;
        const exatos = produtos.filter(ehExato);
        if (exatos.length === 1) {
          adicionarProdutoSelecionado(exatos[0]);
          return;
        }
        if (!produtos.length) {
          fecharLista('Nenhum produto encontrado.');
          notificar(`Produto não encontrado: ${termo}`, 'danger');
          return;
        }
        const aviso = exatos.length > 1
          ? `Mais de um produto corresponde a "${termo}". Selecione o produto.`
          : `Nenhum código corresponde exatamente a "${termo}". Selecione o produto na lista.`;
        mostrarCandidatos(termo, produtos, { aviso });
        notificar(aviso, 'warning');
      })
      .catch((err) => {
        if (reqId !== requisicaoAtual) return;
        fecharLista('Erro ao buscar produtos.');
        notificar(err.message, 'danger');
      });
  }

  function confirmarEntrada() {
    const input = obterInput();
    if (!input) return;

    const termo = input.value.trim();
    if (!termo) return;

    if (termoResultados === termo && resultados.length) {
      if (dropdownAberto && indiceSelecionado >= 0 && resultados[indiceSelecionado]) {
        adicionarProdutoSelecionado(resultados[indiceSelecionado]);
        return;
      }
      notificar('Selecione o produto na lista (setas + Enter ou clique).', 'warning');
      return;
    }

    cancelarBuscaPendente();
    if (typeof global.adicionarProdutoPorCodigo !== 'function') return;
    const situacao = global.adicionarProdutoPorCodigo(termo);
    if (situacao === 'ADICIONADO' || situacao === 'NAO_ENCONTRADO') {
      limparCampo();
    } else if (situacao === 'SELECAO' && avisoLista) {
      notificar(avisoLista, 'warning');
    }
  }

  function buscarProdutos(termo) {
    const lista = obterLista();
    if (!termo || termo.length < 1) {
      fecharLista();
      return;
    }

    const local = resolverLocal(termo);
    if (local.status === 'AMBIGUO' && typeof global.mostrarCandidatosEntradaPdv === 'function') {
      global.mostrarCandidatosEntradaPdv(termo, local);
      return;
    }
    if (local.status === 'UNICO') {
      const tipo = local.balanca ? 'Etiqueta de balança' : 'Código detectado';
      fecharLista(`${tipo}: ${local.produto.nome} — pressione Enter para adicionar.`);
      return;
    }
    if (local.balanca) {
      fecharLista(`Etiqueta de balança sem produto correspondente (PLU ${local.balanca.plu}).`);
      return;
    }

    const reqId = ++requisicaoAtual;
    if (lista) {
      lista.innerHTML = '<p class="vazio">Buscando...</p>';
      lista.classList.add('aberta');
    }

    consultarApi(termo)
      .then((produtos) => {
        if (reqId !== requisicaoAtual) return;
        const exatos = produtos.filter(ehExato);
        const indice = exatos.length === 1 ? produtos.indexOf(exatos[0]) : -1;
        const aviso = exatos.length > 1
          ? `Mais de um produto corresponde a "${termo}". Selecione o produto.`
          : '';
        definirResultados(termo, produtos, { indice, aviso });
      })
      .catch((err) => {
        if (reqId !== requisicaoAtual) return;
        fecharLista('Erro ao buscar produtos.');
        notificar(err.message, 'danger');
      });
  }

  function onInput() {
    const input = obterInput();
    if (!input) return;

    const termo = input.value.trim();
    cancelarBuscaPendente();
    timerBusca = setTimeout(() => buscarProdutos(termo), DEBOUNCE_MS);
  }

  function onKeyDown(event) {
    const input = obterInput();
    if (!input || event.target !== input) return;

    if ((event.key === 'Tab' && !event.shiftKey) || event.key === 'ArrowDown') {
      if (!resultados.length) return;
      if (termoResultados !== input.value.trim()) return;
      const primeiroDisponivel = obterIndiceDisponivel(0, 1);
      if (primeiroDisponivel < 0) return;
      event.preventDefault();
      event.stopPropagation();
      focarResultado(primeiroDisponivel);
      return;
    }

    if (event.key === 'ArrowUp') {
      if (!resultados.length) return;
      event.preventDefault();
      event.stopPropagation();
      indiceSelecionado = Math.max(indiceSelecionado - 1, 0);
      renderizarLista();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      confirmarEntrada();
      return;
    }

    if (event.key === 'Escape') {
      if (dropdownAberto) {
        event.preventDefault();
        event.stopPropagation();
        fecharLista();
        return;
      }
    }
  }

  function onListaKeyDown(event) {
    const botao = event.target.closest('.pdv-autocomplete-item');
    if (!botao) return;

    const index = Number(botao.dataset.index);
    if (!Number.isInteger(index)) return;

    if (event.key === 'ArrowDown') {
      const proximo = obterIndiceDisponivel(index + 1, 1);
      if (proximo < 0) return;
      event.preventDefault();
      event.stopPropagation();
      focarResultado(proximo);
      return;
    }

    if (event.key === 'ArrowUp') {
      const anterior = obterIndiceDisponivel(index - 1, -1);
      event.preventDefault();
      event.stopPropagation();
      if (anterior < 0) {
        indiceSelecionado = -1;
        renderizarLista();
        obterInput()?.focus();
        return;
      }
      focarResultado(anterior);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      fecharLista();
      obterInput()?.focus();
    }
  }

  function onListaClick(event) {
    const botao = event.target.closest('.pdv-autocomplete-item');
    if (!botao || botao.disabled) return;

    const index = Number(botao.dataset.index);
    if (!Number.isFinite(index) || !resultados[index]) return;

    adicionarProdutoSelecionado(resultados[index]);
  }

  function inicializar() {
    const input = obterInput();
    const lista = obterLista();
    if (!input || !lista) return;

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);
    lista.addEventListener('click', onListaClick);
    lista.addEventListener('keydown', onListaKeyDown);

    const btnBuscar = document.getElementById('btnBuscarProdutoPdv');
    if (btnBuscar) {
      btnBuscar.addEventListener('click', () => confirmarEntrada());
    }

    fecharLista();
  }

  global.PdvBuscaProduto = {
    inicializar,
    estaAberto: () => dropdownAberto,
    fechar: fecharLista,
    confirmarEntrada,
    mostrarCandidatos,
    resolverPelaApi
  };
})(typeof window !== 'undefined' ? window : global);
