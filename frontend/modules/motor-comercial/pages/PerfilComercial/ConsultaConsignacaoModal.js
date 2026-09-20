/**
 * Modal de consulta da consignação (RCM-8.0) — somente leitura.
 */

const {
  formatMoneyBr,
  formatDateTimeBr
} = require('./historicoConsignacoesMappers');

function escapeHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class ConsultaConsignacaoModal {
  static render(detalhe, ctx = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'cds-consulta-consignacao';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'consulta-consignacao-titulo');

    const produtos = (detalhe.produtos || []).map((p) => `
      <tr>
        <td>${escapeHtml(p.produto)}</td>
        <td>${escapeHtml(p.quantidade)}</td>
        <td>${escapeHtml(p.unidade)}</td>
        <td>${escapeHtml(p.unidadeComercial || p.unidade)}</td>
        <td>${escapeHtml(formatMoneyBr(p.precoUnitario))}</td>
        <td>${escapeHtml(formatMoneyBr(p.total))}</td>
        <td>${escapeHtml(p.statusLabel || p.status || '—')}</td>
      </tr>`).join('');

    const precificacao = (detalhe.produtos || []).map((p) => {
      const fallback = p.precoFallback ? '<span class="cds-consulta-consignacao__fallback">Preço de Segurança</span>' : '';
      return `
        <li>
          <strong>${escapeHtml(p.produto)}</strong>
          <span>Linha: ${escapeHtml(p.linhaComercialId ?? '—')}</span>
          <span>Tabela: ${escapeHtml(p.tabelaPrecoId ?? detalhe.tabelaPrecoId ?? '—')}</span>
          <span>Canal: ${escapeHtml(p.canalVenda || detalhe.canalOperacao || 'CONSIGNADO')}</span>
          <span>Unidade Comercial: ${escapeHtml(p.unidadeComercial || p.unidade)}</span>
          <span>Preço: ${escapeHtml(formatMoneyBr(p.precoUnitario))}</span>
          <span>Origem: ${escapeHtml(p.precoOrigem || '—')}</span>
          ${fallback}
        </li>`;
    }).join('');

    overlay.innerHTML = `
      <div class="cds-consulta-consignacao__painel">
        <header class="cds-consulta-consignacao__cabecalho">
          <h2 id="consulta-consignacao-titulo">CONSIGNAÇÃO Nº ${escapeHtml(detalhe.numero)}</h2>
          <p>Cliente: ${escapeHtml(detalhe.clienteNome)}</p>
          <p>Data: ${escapeHtml(formatDateTimeBr(detalhe.dataHora))}</p>
          <p>Status: <strong>${escapeHtml(String(detalhe.statusLabel || '').toUpperCase())}</strong></p>
          <button type="button" class="cds-consulta-consignacao__fechar" data-action="fechar" aria-label="Fechar">×</button>
        </header>

        <section>
          <h3>Identificação</h3>
          <dl class="cds-consulta-consignacao__resumo">
            <div><dt>Nº da consignação</dt><dd>${escapeHtml(detalhe.numero)}</dd></div>
            <div><dt>Cliente</dt><dd>${escapeHtml(detalhe.clienteNome)}</dd></div>
            <div><dt>Data</dt><dd>${escapeHtml(formatDateTimeBr(detalhe.dataHora))}</dd></div>
            <div><dt>Status</dt><dd>${escapeHtml(detalhe.statusLabel)}</dd></div>
            <div><dt>Última atualização</dt><dd>${escapeHtml(formatDateTimeBr(detalhe.atualizadoEm))}</dd></div>
            <div><dt>Operador</dt><dd>${escapeHtml(detalhe.operador ?? '—')}</dd></div>
          </dl>
        </section>

        <section>
          <h3>Operação</h3>
          <dl class="cds-consulta-consignacao__resumo">
            <div><dt>Tipo Comercial</dt><dd>${escapeHtml(detalhe.tipoComercial || '—')}</dd></div>
            <div><dt>Canal da Operação</dt><dd>${escapeHtml(detalhe.canalOperacao || 'CONSIGNADO')}</dd></div>
            <div><dt>Tabela de Preços</dt><dd>${escapeHtml(detalhe.tabelaPrecoId ?? '—')}</dd></div>
            <div><dt>Situação da consignação</dt><dd>${escapeHtml(detalhe.situacao || detalhe.statusLabel)}</dd></div>
          </dl>
        </section>

        <section>
          <h3>Produtos</h3>
          <div class="cds-consulta-consignacao__tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Unidade</th>
                  <th>Unidade Comercial</th>
                  <th>Preço Unitário</th>
                  <th>Valor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${produtos || '<tr><td colspan="7">Nenhum produto</td></tr>'}</tbody>
            </table>
          </div>
        </section>

        <section>
          <h3>Dados da entrega</h3>
          <p>Identificação: ${escapeHtml(detalhe.numero)}</p>
          <p>Entrega: ${escapeHtml(formatDateTimeBr(detalhe.dataEntrega))}</p>
        </section>

        <section class="cds-consulta-consignacao__snapshot">
          <h3>Precificação congelada</h3>
          <ul>${precificacao || '<li>Sem snapshot de itens</li>'}</ul>
        </section>

        <footer class="cds-consulta-consignacao__acoes">
          <button type="button" class="cds-consulta-consignacao__btn cds-consulta-consignacao__btn--primary" data-action="reimprimir">Reimprimir</button>
          <button type="button" class="cds-consulta-consignacao__btn" data-action="fechar">Fechar</button>
        </footer>
      </div>
    `;

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        if (ctx.onClose) ctx.onClose();
      }
    });
    overlay.querySelectorAll('[data-action="fechar"]').forEach((btn) => {
      btn.addEventListener('click', () => ctx.onClose && ctx.onClose());
    });
    overlay.querySelector('[data-action="reimprimir"]').addEventListener('click', () => {
      if (ctx.onReimprimir) ctx.onReimprimir(detalhe);
    });

    return overlay;
  }
}

module.exports = ConsultaConsignacaoModal;
