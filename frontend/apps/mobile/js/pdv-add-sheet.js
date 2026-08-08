/**
 * RCM-05.14 — Bottom Sheet único de adição de produtos (PDV Mobile V2)
 * UI apenas — preço/forma vêm do ComercialPrecoResolver (caller).
 */
import { escapeHtml, asText, formatMoney } from './formatters.js';
import {
  openBottomSheet,
  closeBottomSheet,
  qtyControlHtml,
  bindQtyControls,
  parseQty
} from './forms.js';

function rotuloUnidade(forma, unidade) {
  const f = String(forma || '').toUpperCase();
  const u = String(unidade || '').toUpperCase();
  if (u) return u === 'LITRO' ? 'L' : u;
  if (f === 'PESO') return 'KG';
  if (f === 'VOLUME') return 'L';
  return 'UN';
}

function labelQuantidade(forma) {
  const f = String(forma || '').toUpperCase();
  if (f === 'PESO') return 'Peso (Kg)';
  if (f === 'VOLUME') return 'Litros';
  return 'Quantidade';
}

function headHtml(ctx) {
  const un = rotuloUnidade(ctx.forma, ctx.unidade);
  const linha = ctx.linhaNome || ctx.categoriaNome || '';
  return `
    <div class="cds-pdv-add__head">
      <h3 class="cds-pdv-add__nome">${escapeHtml(asText(ctx.nome, 'Produto'))}</h3>
      ${linha ? `<p class="cds-pdv-add__linha">${escapeHtml(linha)}</p>` : ''}
      <p class="cds-pdv-add__codigo">Código ${escapeHtml(asText(ctx.codigo, '—'))}</p>
      <p class="cds-pdv-add__preco">${escapeHtml(formatMoney(ctx.preco))} / ${escapeHtml(un)}</p>
    </div>
  `;
}

function qtyBlockHtml(forma) {
  const f = String(forma || '').toUpperCase();
  const decimal = f === 'PESO' || f === 'VOLUME';
  const min = decimal ? 0.001 : 1;
  const step = decimal ? 0.1 : 1;
  const value = decimal ? '' : '1';
  return `
    <div class="cds-pdv-add__qty">
      <label class="cds-pdv-add__qty-label" for="pdv-add-qtd">${escapeHtml(labelQuantidade(forma))}</label>
      ${qtyControlHtml({
        name: 'quantidade',
        value: value || (decimal ? '0,100' : '1'),
        min,
        step,
        id: 'pdv-add-qtd',
        enterkeyhint: 'done'
      })}
      <p class="cds-muted cds-pdv-add__hint">Toque no número para digitar · +/− para ajustar</p>
    </div>
  `;
}

function actionsHtml(confirmLabel = 'Adicionar') {
  return `
    <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-sheet-close data-cancel>Cancelar</button>
    <button type="button" class="cds-mobile-btn" data-ok>${escapeHtml(confirmLabel)}</button>
  `;
}

function kitItensHtml(itens) {
  if (!Array.isArray(itens) || !itens.length) {
    return '<p class="cds-muted">Sem itens no kit.</p>';
  }
  return `
    <ul class="cds-pdv-add__kit-list">
      ${itens.map((i) => `
        <li>• ${escapeHtml(asText(i.produto_nome || i.produto_id))} × ${escapeHtml(asText(i.quantidade, '1'))}</li>
      `).join('')}
    </ul>
  `;
}

function readQtd(sheet, forma) {
  const raw = sheet.querySelector('#pdv-add-qtd')?.value;
  const n = parseQty(raw);
  const f = String(forma || '').toUpperCase();
  if (f === 'PESO' || f === 'VOLUME') {
    return Number.isFinite(n) && n > 0 ? n : NaN;
  }
  if (!Number.isFinite(n) || n < 1) return NaN;
  return Math.round(n);
}

/**
 * Abre o bottom sheet de adição conforme a forma comercial.
 * @returns {Promise<object|null>} payload para o carrinho ou null se cancelado
 */
export function openPdvAddProdutoSheet(ctx = {}) {
  const forma = String(ctx.forma || '').toUpperCase() || 'UNIDADE';

  if (forma === 'CASQUINHA') {
    return openCasquinhaSheet(ctx);
  }

  return new Promise((resolve) => {
    const isKit = forma === 'KIT' || !!ctx.kit;
    const bodyParts = [headHtml(ctx)];
    if (isKit) {
      bodyParts.push(`<div class="cds-pdv-add__section"><strong>Itens do kit</strong>${kitItensHtml(ctx.kit?.itens || [])}</div>`);
    }
    bodyParts.push(qtyBlockHtml(isKit ? 'UNIDADE' : forma));

    const sheet = openBottomSheet({
      title: '',
      bodyHtml: `<div class="cds-pdv-add" data-forma="${escapeHtml(forma)}">${bodyParts.join('')}</div>`,
      actionsHtml: actionsHtml('Adicionar'),
      panelClass: 'cds-sheet__panel--pdv-add',
      closeMs: 150
    });

    const finish = (value) => {
      closeBottomSheet();
      resolve(value);
    };

    bindQtyControls(sheet, {
      min: (forma === 'PESO' || forma === 'VOLUME') ? 0.001 : 1,
      step: (forma === 'PESO' || forma === 'VOLUME') ? 0.1 : 1
    });

    sheet.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', () => finish(null));
    sheet.querySelector('[data-ok]')?.addEventListener('click', () => {
      const qtd = readQtd(sheet, isKit ? 'UNIDADE' : forma);
      if (!Number.isFinite(qtd) || qtd <= 0) {
        const input = sheet.querySelector('#pdv-add-qtd');
        input?.classList.add('is-invalid');
        input?.focus();
        return;
      }
      finish({
        qtd,
        preco: Number(ctx.preco || 0),
        forma: isKit ? 'KIT' : (forma === 'PESO' || forma === 'VOLUME' ? forma : (forma || null)),
        unidade: ctx.unidade || null,
        canal: ctx.canal || 'VAREJO',
        tipoVenda: (forma === 'PESO' || forma === 'VOLUME') ? 'PESO' : 'UNIDADE',
        quantidadeBolas: null,
        sabores: null,
        kitId: ctx.kit?.id || null,
        kitItens: isKit
          ? (ctx.kit?.itens || []).map((i) => ({
            produto_id: i.produto_id,
            quantidade: i.quantidade,
            produto_nome: i.produto_nome
          }))
          : null
      });
    });

    requestAnimationFrame(() => {
      const input = sheet.querySelector('#pdv-add-qtd');
      if (forma === 'PESO' || forma === 'VOLUME') {
        input?.focus();
        input?.select();
      }
    });
  });
}

function openCasquinhaSheet(ctx) {
  return new Promise((resolve) => {
    let step = 'intro';
    let quantidadeBolas = 1;
    const escolhidos = [];
    const bolasMax = Number(ctx.casquinha?.bolasMax || 4);
    const permitirRepetir = ctx.casquinha?.permitirRepetir !== false;
    const lista = Array.isArray(ctx.casquinha?.sabores) ? ctx.casquinha.sabores : [];

    const finish = (value) => {
      closeBottomSheet();
      resolve(value);
    };

    const sheet = openBottomSheet({
      title: '',
      bodyHtml: '<div class="cds-pdv-add" id="pdv-casq-body"></div>',
      actionsHtml: '<div id="pdv-casq-actions" style="display:contents"></div>',
      panelClass: 'cds-sheet__panel--pdv-add',
      closeMs: 150
    });

    const bodyHost = sheet.querySelector('#pdv-casq-body');
    const actionsHost = sheet.querySelector('.cds-sheet__actions');

    const paint = () => {
      if (step === 'intro') {
        bodyHost.innerHTML = `
          ${headHtml(ctx)}
          <p class="cds-muted">Monte a casquinha e confirme para adicionar à venda.</p>
        `;
        actionsHost.innerHTML = `
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-cancel>Cancelar</button>
          <button type="button" class="cds-mobile-btn" data-montar>Montar Casquinha</button>
        `;
        actionsHost.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
        actionsHost.querySelector('[data-montar]')?.addEventListener('click', () => {
          step = 'builder';
          paint();
        });
        return;
      }

      if (step === 'builder') {
        const nomes = lista.map((s) => asText(s.nome || s.descricao)).filter(Boolean);
        bodyHost.innerHTML = `
          ${headHtml(ctx)}
          <div class="cds-pdv-add__qty">
            <label class="cds-pdv-add__qty-label" for="pdv-add-bolas">Quantidade de bolas (1–${bolasMax})</label>
            ${qtyControlHtml({
              name: 'bolas',
              value: String(quantidadeBolas),
              min: 1,
              step: 1,
              id: 'pdv-add-bolas'
            })}
          </div>
          <div class="cds-pdv-add__section">
            <strong>Sabores ${escolhidos.length}/${quantidadeBolas}</strong>
            <div class="cds-pdv-add__sabores">
              ${nomes.map((n) => `
                <button type="button" class="cds-pdv-add__sabor" data-sabor="${escapeHtml(n)}">${escapeHtml(n)}</button>
              `).join('') || '<p class="cds-muted">Nenhum sabor cadastrado — digite abaixo.</p>'}
            </div>
            <input type="text" class="cds-field__input cds-pdv-add__sabor-input" id="pdv-sabor-livre"
              placeholder="Ou digite o sabor e Enter" enterkeyhint="done" autocomplete="off">
            <ul class="cds-pdv-add__escolhidos">
              ${escolhidos.map((s, i) => `
                <li>${i + 1}. ${escapeHtml(s.nome)}
                  <button type="button" class="cds-pdv-add__rm" data-rm="${i}" aria-label="Remover">×</button>
                </li>
              `).join('')}
            </ul>
          </div>
        `;
        actionsHost.innerHTML = `
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-cancel>Cancelar</button>
          <button type="button" class="cds-mobile-btn" data-ok ${escolhidos.length !== quantidadeBolas ? 'disabled' : ''}>Adicionar</button>
        `;

        bindQtyControls(sheet, { min: 1, step: 1 });
        const bolasInput = sheet.querySelector('#pdv-add-bolas');
        bolasInput?.addEventListener('input', () => {
          const n = Math.max(1, Math.min(bolasMax, Math.round(parseQty(bolasInput.value) || 1)));
          quantidadeBolas = n;
          if (escolhidos.length > n) escolhidos.length = n;
          paint();
        });
        sheet.querySelectorAll('[data-qty-delta]').forEach((btn) => {
          btn.addEventListener('click', () => {
            setTimeout(() => {
              const n = Math.max(1, Math.min(bolasMax, Math.round(parseQty(bolasInput?.value) || 1)));
              quantidadeBolas = n;
              if (escolhidos.length > n) escolhidos.length = n;
              paint();
            }, 0);
          });
        });

        const addSabor = (nomeSabor) => {
          const nome = String(nomeSabor || '').trim();
          if (!nome) return;
          if (escolhidos.length >= quantidadeBolas) return;
          if (!permitirRepetir && escolhidos.some((x) => x.nome.toLowerCase() === nome.toLowerCase())) {
            return;
          }
          const hit = lista.find(
            (s) => String(s.nome || s.descricao || '').toLowerCase() === nome.toLowerCase()
          );
          escolhidos.push({ id: hit?.id || null, nome: hit?.nome || nome });
          paint();
        };

        sheet.querySelectorAll('[data-sabor]').forEach((btn) => {
          btn.addEventListener('click', () => addSabor(btn.getAttribute('data-sabor')));
        });
        sheet.querySelectorAll('[data-rm]').forEach((btn) => {
          btn.addEventListener('click', () => {
            escolhidos.splice(Number(btn.getAttribute('data-rm')), 1);
            paint();
          });
        });
        const livre = sheet.querySelector('#pdv-sabor-livre');
        livre?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addSabor(livre.value);
            livre.value = '';
          }
        });

        actionsHost.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
        actionsHost.querySelector('[data-ok]')?.addEventListener('click', () => {
          if (escolhidos.length !== quantidadeBolas) return;
          step = 'resumo';
          paint();
        });
        return;
      }

      // resumo
      bodyHost.innerHTML = `
        ${headHtml(ctx)}
        <div class="cds-pdv-add__section">
          <strong>Resumo</strong>
          <p class="cds-muted" style="margin:6px 0 0">${quantidadeBolas} bola(s)</p>
          <ul class="cds-pdv-add__escolhidos">
            ${escolhidos.map((s, i) => `<li>${i + 1}. ${escapeHtml(s.nome)}</li>`).join('')}
          </ul>
        </div>
      `;
      actionsHost.innerHTML = `
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-voltar>Voltar</button>
        <button type="button" class="cds-mobile-btn" data-ok>Adicionar</button>
      `;
      actionsHost.querySelector('[data-voltar]')?.addEventListener('click', () => {
        step = 'builder';
        paint();
      });
      actionsHost.querySelector('[data-ok]')?.addEventListener('click', () => {
        finish({
          qtd: 1,
          preco: Number(ctx.preco || 0),
          forma: 'CASQUINHA',
          unidade: 'UN',
          canal: ctx.canal || 'VAREJO',
          tipoVenda: 'UNIDADE',
          quantidadeBolas,
          sabores: escolhidos.slice(),
          kitId: null,
          kitItens: null
        });
      });
    };

    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', () => finish(null));
    paint();
  });
}
