/**
 * Formulário único de cadastro/edição de cliente — Sprint UX-01.
 *
 * Orquestra ERP (/clientes) + perfis comerciais existentes sem alterar backend.
 *
 * @module frontend/modules/motor-comercial/pages/PerfilComercial/ClienteCadastroView
 */

const Button = require('../../components/base/Button');
const Input = require('../../components/form/Input');
const Checkbox = require('../../components/form/Checkbox');
const Textarea = require('../../components/form/Textarea');
const Alert = require('../../components/base/Alert');
const {
  CAPACIDADES_DEFINICOES,
  buildObservacoesCapacidade,
  resolverPerfilTipoParaCapacidade
} = require('./capacidadesComerciais');
const {
  fetchErp,
  notify,
  withLoading,
  choiceDialog
} = require('../../utils/operacional');
const { extrairValorInput } = require('../../utils/formField');

const DRAFT_KEY = 'motor-comercial:cliente-cadastro-rascunho';

class ClienteCadastroView {
  /**
   * @param {Object} options
   * @param {boolean} [options.isEdit]
   * @param {number|null} [options.clienteId]
   * @param {Object} [options.api] - MotorComercialApi instance
   * @param {Function} options.onSalvo
   * @param {Function} options.onCancelar
   */
  constructor(options = {}) {
    this.isEdit = !!options.isEdit;
    this.clienteId = options.clienteId || null;
    this.api = options.api;
    this.onSalvo = options.onSalvo || (() => {});
    this.onCancelar = options.onCancelar || (() => {});
    this.dirty = false;
    this.perfisExistentes = [];
    this.capacidadesState = {};
    this.tipoComercialId = null;
    this._cadastroCarregado = false;
    this._cepBuscaTimer = null;
    this._ultimoCepConsultado = '';
    this._cepAbort = null;
    this._beforeUnload = this._beforeUnload.bind(this);
  }

  /**
   * @returns {HTMLElement}
   */
  render() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-cliente-cadastro';
    wrap.id = 'cliente-cadastro-root';

    const header = document.createElement('div');
    header.className = 'cds-cliente-cadastro__header';
    header.innerHTML = `
      <div>
        <h1>${this.isEdit ? 'Editar Cliente' : 'Novo Cliente'}</h1>
        <p>Cadastre o cliente e habilite as capacidades comerciais necessárias.</p>
      </div>
    `;
    const headerActions = document.createElement('div');
    headerActions.className = 'cds-cliente-cadastro__header-actions';
    headerActions.appendChild(Button.create({
      text: 'Voltar',
      variant: 'ghost',
      onClick: () => this._sairComProtecao()
    }));
    header.appendChild(headerActions);
    wrap.appendChild(header);

    const formHost = document.createElement('div');
    formHost.id = 'cliente-cadastro-form';
    formHost.appendChild(this._buildFormSkeleton());
    wrap.appendChild(formHost);

    const footer = document.createElement('div');
    footer.className = 'cds-cliente-cadastro__footer';
    footer.appendChild(Button.create({
      text: 'Cancelar',
      variant: 'secondary',
      onClick: () => this._sairComProtecao()
    }));
    footer.appendChild(Button.create({
      text: 'Salvar',
      variant: 'primary',
      onClick: () => this._salvar()
    }));
    wrap.appendChild(footer);

    window.addEventListener('beforeunload', this._beforeUnload);
    setTimeout(() => this._carregarDados(), 0);

    return wrap;
  }

  destroy() {
    window.removeEventListener('beforeunload', this._beforeUnload);
  }

  _beforeUnload(event) {
    if (!this.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }

  _markDirty() {
    this.dirty = true;
  }

  _formatarCep(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length > 5) return digits.replace(/(\d{5})(\d{1,3})/, '$1-$2');
    return digits;
  }

  _onCepChange(rawValue) {
    this._markDirty();
    const formatted = this._formatarCep(rawValue);
    this._setFieldValue('cep', formatted);
    const cep = formatted.replace(/\D/g, '');

    clearTimeout(this._cepBuscaTimer);
    if (cep.length < 8) {
      this._ultimoCepConsultado = '';
      return;
    }

    this._cepBuscaTimer = setTimeout(() => this._buscarEnderecoPorCep(cep), 250);
  }

  async _buscarEnderecoPorCep(cepDigits) {
    const cep = String(cepDigits || '').replace(/\D/g, '');
    if (cep.length !== 8 || cep === this._ultimoCepConsultado) return;

    if (this._cepAbort) this._cepAbort.abort();
    this._cepAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: this._cepAbort ? this._cepAbort.signal : undefined
      });
      const data = await response.json();
      if (data.erro) {
        this._ultimoCepConsultado = '';
        notify('CEP não encontrado.', 'warning');
        return;
      }
      this._ultimoCepConsultado = cep;
      this._setFieldValue('rua', data.logradouro || '');
      this._setFieldValue('bairro', data.bairro || '');
      this._setFieldValue('cidade', data.localidade || '');
      this._setFieldValue('uf', data.uf || '');
      this._markDirty();
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      this._ultimoCepConsultado = '';
      notify('Erro ao buscar o CEP.', 'error');
    }
  }

  _buildFormSkeleton() {
    const frag = document.createDocumentFragment();

    frag.appendChild(this._section('dados', 'Dados Cadastrais', true, this._buildDadosCadastrais()));
    frag.appendChild(this._section('capacidades', 'Capacidades Comerciais', true, this._buildCapacidades()));

    return frag;
  }

  _section(id, title, open, content) {
    const section = document.createElement('section');
    section.className = 'cds-cliente-cadastro__section';
    section.dataset.section = id;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'cds-cliente-cadastro__section-head';
    head.innerHTML = `<span>${title}</span><span class="cds-cliente-cadastro__chevron">${open ? '▾' : '▸'}</span>`;

    const body = document.createElement('div');
    body.className = 'cds-cliente-cadastro__section-body';
    body.hidden = !open;
    body.appendChild(content);

    head.addEventListener('click', () => {
      body.hidden = !body.hidden;
      head.querySelector('.cds-cliente-cadastro__chevron').textContent = body.hidden ? '▸' : '▾';
    });

    section.appendChild(head);
    section.appendChild(body);
    return section;
  }

  _fieldGrid(fields) {
    const grid = document.createElement('div');
    grid.className = 'cds-cliente-cadastro__grid';
    fields.forEach((f) => grid.appendChild(f));
    return grid;
  }

  _buildDadosCadastrais() {
    const wrap = document.createElement('div');
    wrap.appendChild(this._fieldGrid([
      Input.create({ label: 'Nome', name: 'nome', required: true, onChange: () => this._markDirty() }),
      Input.create({ label: 'CPF/CNPJ', name: 'cpf_cnpj', onChange: () => this._markDirty() }),
      Input.create({
        label: 'Inscrição Estadual',
        name: 'inscricao_estadual',
        placeholder: 'Número ou ISENTO',
        onChange: () => this._markDirty()
      }),
      Input.create({ label: 'Telefone', name: 'telefone', onChange: () => this._markDirty() }),
      Input.create({ label: 'Celular', name: 'celular', onChange: () => this._markDirty() }),
      Input.create({ label: 'Email', name: 'email', type: 'email', onChange: () => this._markDirty() }),
      Input.create({
        label: 'CEP',
        name: 'cep',
        placeholder: '00000-000',
        onChange: (value) => this._onCepChange(value)
      }),
      Input.create({ label: 'Endereço', name: 'rua', onChange: () => this._markDirty() }),
      Input.create({ label: 'Número', name: 'numero', onChange: () => this._markDirty() }),
      Input.create({ label: 'Bairro', name: 'bairro', onChange: () => this._markDirty() }),
      Input.create({ label: 'Cidade', name: 'cidade', onChange: () => this._markDirty() }),
      Input.create({ label: 'Estado', name: 'uf', onChange: () => this._markDirty() })
    ]));
    return wrap;
  }

  _buildCapacidades() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-cliente-cadastro__capacidades';
    wrap.id = 'cliente-cadastro-capacidades';

    CAPACIDADES_DEFINICOES.forEach((cap) => {
      const item = document.createElement('div');
      item.className = 'cds-cliente-cadastro__cap-item';
      item.dataset.capKey = cap.key;

      const row = document.createElement('div');
      row.className = 'cds-cliente-cadastro__cap-row';

      const check = Checkbox.create({
        label: cap.label,
        checked: false,
        onChange: (checked) => {
          this.capacidadesState[cap.key] = this.capacidadesState[cap.key] || {};
          this.capacidadesState[cap.key].enabled = checked;
          this._markDirty();
          this._toggleCapConfig(cap.key, checked);
        }
      });
      check.dataset.role = 'cap-check';
      row.appendChild(check);
      item.appendChild(row);

      const config = document.createElement('div');
      config.className = 'cds-cliente-cadastro__cap-config';
      config.hidden = true;
      config.dataset.role = 'cap-config';

      if (cap.configFields.includes('limiteComercial')) {
        config.appendChild(Input.create({
          label: 'Limite Comercial',
          name: `cap-${cap.key}-limite`,
          type: 'number',
          value: '0',
          onChange: () => this._markDirty()
        }));
      }
      if (cap.configFields.includes('limiteCredito')) {
        config.appendChild(Input.create({
          label: 'Limite de Crédito',
          name: `cap-${cap.key}-limite-credito`,
          type: 'number',
          value: '0',
          onChange: () => this._markDirty()
        }));
      }
      if (cap.configFields.includes('prazoPrestacao')) {
        config.appendChild(Input.create({
          label: 'Prazo para Fechamento (dias)',
          name: `cap-${cap.key}-prazo`,
          type: 'number',
          value: '30',
          onChange: () => this._markDirty()
        }));
      }
      if (cap.configFields.includes('observacoes')) {
        const obsField = Textarea.create({
          label: 'Observações',
          rows: 2,
          onChange: () => this._markDirty()
        });
        const obsInput = obsField.querySelector('textarea');
        if (obsInput) obsInput.name = `cap-${cap.key}-obs`;
        config.appendChild(obsField);
      }

      item.appendChild(config);
      wrap.appendChild(item);
    });

    return wrap;
  }

  _toggleCapConfig(key, visible) {
    const item = document.querySelector(`[data-cap-key="${key}"] [data-role="cap-config"]`);
    if (item) item.hidden = !visible;
  }

  _setFieldValue(name, value) {
    const el = document.querySelector(`[name="${name}"]`);
    if (!el) return;
    const input = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : el.querySelector('input, textarea');
    if (input) input.value = value ?? '';
  }

  _getFieldValue(name) {
    const el = document.querySelector(`[name="${name}"]`);
    return extrairValorInput(el);
  }

  async _carregarDados() {
    if (!this.isEdit || !this.clienteId) {
      this._restaurarRascunho();
      return;
    }

    try {
      const [cliente, perfisResult] = await Promise.all([
        fetchErp(`/clientes/${this.clienteId}`),
        this.api.listarPerfis({ clienteId: this.clienteId, pageSize: 50 })
      ]);

      this.perfisExistentes = perfisResult.items || [];
      this._preencherDadosCadastrais(cliente);
      this._cadastroCarregado = true;
      this._preencherCapacidades(this.perfisExistentes);
    } catch (error) {
      const host = document.getElementById('cliente-cadastro-form');
      if (host) {
        host.prepend(Alert.create({ message: error.message, variant: 'error' }));
      }
    }
  }

  _preencherDadosCadastrais(cliente = {}) {
    this.tipoComercialId = cliente.tipo_comercial_id ?? null;
    this._setFieldValue('nome', cliente.nome);
    this._setFieldValue('cpf_cnpj', cliente.cpf_cnpj);
    this._setFieldValue('inscricao_estadual', cliente.inscricao_estadual);
    this._setFieldValue('telefone', cliente.telefone);
    this._setFieldValue('email', cliente.email);
    this._setFieldValue('cep', cliente.cep);
    this._setFieldValue('rua', cliente.rua);
    this._setFieldValue('numero', cliente.numero);
    this._setFieldValue('bairro', cliente.bairro);
    this._setFieldValue('cidade', cliente.cidade);
    this._setFieldValue('uf', cliente.uf);
  }

  _preencherCapacidades(perfis = []) {
    perfis.forEach((perfil) => {
      const def = CAPACIDADES_DEFINICOES.find((c) => c.perfilTipo === perfil.perfilTipo);
      if (!def) return;

      const item = document.querySelector(`[data-cap-key="${def.key}"]`);
      if (!item) return;

      const checkbox = item.querySelector('[data-role="cap-check"] input');
      if (checkbox) {
        checkbox.checked = true;
        this._toggleCapConfig(def.key, true);
      }

      if (def.configFields.includes('limiteComercial')) {
        this._setFieldValue(`cap-${def.key}-limite`, String(perfil.limiteComercial ?? 0));
      }
      if (def.configFields.includes('limiteCredito')) {
        this._setFieldValue(`cap-${def.key}-limite-credito`, String(perfil.limiteComercial ?? 0));
      }
      if (def.configFields.includes('observacoes')) {
        this._setFieldValue(`cap-${def.key}-obs`, perfil.observacoes || '');
      }

      this.capacidadesState[def.key] = {
        enabled: true,
        perfilId: perfil.id,
        perfilTipo: perfil.perfilTipo
      };
    });
  }

  _coletarDadosCadastrais() {
    const telefone = this._getFieldValue('telefone');
    const celular = this._getFieldValue('celular');
    const telefoneFinal = telefone && celular && telefone !== celular
      ? `${telefone} / ${celular}`
      : (telefone || celular);

    let limiteCredito = 0;
    const limiteCreditoCap = this._getFieldValue('cap-credito-limite-credito');
    if (limiteCreditoCap) limiteCredito = Number(limiteCreditoCap) || 0;

    const cadastro = {
      nome: this._getFieldValue('nome'),
      cpf_cnpj: this._getFieldValue('cpf_cnpj'),
      inscricao_estadual: this._getFieldValue('inscricao_estadual'),
      telefone: telefoneFinal,
      email: this._getFieldValue('email'),
      cep: this._getFieldValue('cep'),
      rua: this._getFieldValue('rua'),
      numero: this._getFieldValue('numero'),
      bairro: this._getFieldValue('bairro'),
      cidade: this._getFieldValue('cidade'),
      uf: this._getFieldValue('uf')
    };
    // Na edição, o limite de crédito só é enviado quando a capacidade Crédito está marcada;
    // fora dela o PUT preserva o limite atual do cliente.
    if (!this.isEdit || this._capacidadeMarcada('credito')) cadastro.limite_credito = limiteCredito;
    if (this.isEdit && this.tipoComercialId != null) cadastro.tipo_comercial_id = this.tipoComercialId;
    return cadastro;
  }

  _capacidadeMarcada(key) {
    const input = document.querySelector(`[data-cap-key="${key}"] [data-role="cap-check"] input`);
    return !!(input && input.checked);
  }

  _coletarCapacidadesHabilitadas() {
    const habilitadas = CAPACIDADES_DEFINICOES.filter((cap) => {
      const item = document.querySelector(`[data-cap-key="${cap.key}"] [data-role="cap-check"] input`);
      return item && item.checked;
    }).map((cap) => {
      const prazo = this._getFieldValue(`cap-${cap.key}-prazo`);
      const limite = Number(this._getFieldValue(`cap-${cap.key}-limite`) || 0);
      const limiteCredito = Number(this._getFieldValue(`cap-${cap.key}-limite-credito`) || 0);
      const observacoes = this._getFieldValue(`cap-${cap.key}-obs`);
      const existente = this.capacidadesState[cap.key] || {};

      return {
        key: cap.key,
        label: cap.label,
        perfilTipo: resolverPerfilTipoParaCapacidade(cap.key),
        limiteComercial: cap.key === 'credito' ? limiteCredito : limite,
        prazoPrestacao: prazo ? Number(prazo) : null,
        observacoes: buildObservacoesCapacidade({ observacoes }, prazo),
        perfilId: existente.perfilId || null
      };
    });

    const porTipo = new Map();
    habilitadas.forEach((cap) => {
      const atual = porTipo.get(cap.perfilTipo);
      if (!atual) {
        porTipo.set(cap.perfilTipo, { ...cap });
        return;
      }
      const labels = [atual.label, cap.label].filter(Boolean).join(', ');
      const obs = [atual.observacoes, cap.observacoes ? `[${cap.label}] ${cap.observacoes}` : `[${cap.label}]`]
        .filter(Boolean)
        .join('\n');
      porTipo.set(cap.perfilTipo, {
        ...atual,
        label: labels,
        limiteComercial: Math.max(atual.limiteComercial, cap.limiteComercial),
        observacoes: obs
      });
    });

    return [...porTipo.values()];
  }

  _salvarRascunhoLocal() {
    const draft = {
      cadastro: this._coletarDadosCadastrais(),
      capacidades: this._coletarCapacidadesHabilitadas().map((c) => c.key),
      clienteId: this.clienteId
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  _restaurarRascunho() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (this.isEdit && draft.clienteId !== this.clienteId) return;
      Object.entries(draft.cadastro || {}).forEach(([k, v]) => this._setFieldValue(k, v));
      (draft.capacidades || []).forEach((key) => {
        const item = document.querySelector(`[data-cap-key="${key}"] [data-role="cap-check"] input`);
        if (item) {
          item.checked = true;
          this._toggleCapConfig(key, true);
        }
      });
    } catch (_e) {
      // ignora rascunho inválido
    }
  }

  async _sairComProtecao() {
    if (!this.dirty) {
      this.destroy();
      this.onCancelar();
      return;
    }

    const escolha = await choiceDialog({
      title: 'Alterações não salvas',
      message: 'Existem alterações não salvas. O que deseja fazer?',
      choices: [
        { label: 'Continuar editando', value: 'continuar', variant: 'secondary' },
        { label: 'Salvar rascunho', value: 'rascunho', variant: 'primary' },
        { label: 'Descartar', value: 'descartar', variant: 'danger' }
      ]
    });

    if (!escolha || escolha === 'continuar') return;

    if (escolha === 'rascunho') {
      this._salvarRascunhoLocal();
      notify('Rascunho salvo localmente.', 'success');
    } else {
      sessionStorage.removeItem(DRAFT_KEY);
    }

    this.dirty = false;
    this.destroy();
    this.onCancelar();
  }

  async _salvar() {
    if (this.isEdit && !this._cadastroCarregado) {
      notify('Os dados do cliente não foram carregados. Recarregue a tela antes de salvar.', 'error');
      return;
    }
    const cadastro = this._coletarDadosCadastrais();
    if (!cadastro.nome) {
      notify('Informe o nome do cliente.', 'warning');
      return;
    }

    const capacidades = this._coletarCapacidadesHabilitadas();
    if (!capacidades.length) {
      notify('Habilite ao menos uma capacidade comercial.', 'warning');
      return;
    }

    try {
      let clienteId = this.clienteId;

      await withLoading('Salvando cliente...', async () => {
        if (this.isEdit && clienteId) {
          await fetchErp(`/clientes/${clienteId}`, {
            method: 'PUT',
            body: JSON.stringify(cadastro)
          });
        } else {
          const criado = await fetchErp('/clientes', {
            method: 'POST',
            body: JSON.stringify(cadastro)
          });
          clienteId = criado.id;
        }

        for (const cap of capacidades) {
          const perfilExistente = this.perfisExistentes.find((p) => p.perfilTipo === cap.perfilTipo);
          const perfilId = cap.perfilId || perfilExistente?.id;

          if (perfilId) {
            await this.api.atualizarPerfil(perfilId, {
              ativo: true,
              observacoes: cap.observacoes
            });
            if (cap.limiteComercial > 0) {
              await this.api.alterarLimite(perfilId, { novoLimite: cap.limiteComercial });
            }
            continue;
          }

          await this.api.criarPerfil({
            clienteId: Number(clienteId),
            perfilTipo: cap.perfilTipo,
            limiteComercial: cap.limiteComercial,
            observacoes: cap.observacoes
          });
        }
      });

      sessionStorage.removeItem(DRAFT_KEY);
      this.dirty = false;
      notify('Cliente salvo com sucesso.', 'success');
      this.destroy();
      this.onSalvo(Number(clienteId));
    } catch (error) {
      notify(error.message, 'error');
    }
  }
}

module.exports = ClienteCadastroView;
