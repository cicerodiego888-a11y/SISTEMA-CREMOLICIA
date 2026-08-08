/**
 * Mapeadores da Central Operacional de Clientes — Sprint UX-01.
 *
 * @module frontend/modules/motor-comercial/pages/PerfilComercial/clienteOperacionalMappers
 */

const { extrairCapacidadesDosPerfis } = require('./capacidadesComerciais');

function normalizarTextoBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extrairCidade(clienteMestre = {}, perfil = {}) {
  return clienteMestre.cidade
    || perfil.cidade
    || (clienteMestre.endereco && clienteMestre.endereco.cidade)
    || '';
}

function resolverStatusCliente(grupo = {}) {
  const perfis = grupo.perfis || [];
  if (perfis.some((p) => p.bloqueado || p.status === 'BLOQUEADO' || p.situacao === 'BLOQUEADO')) {
    return 'Bloqueado';
  }
  if (perfis.every((p) => p.ativo === false)) return 'Inativo';
  return 'Ativo';
}

function groupPerfisByCliente(perfis = []) {
  const mapa = new Map();

  perfis.forEach((perfil) => {
    // Nunca usar perfil.id como fallback — colide com clienteId de outro cliente.
    const clienteId = perfil.clienteId != null ? Number(perfil.clienteId) : null;
    if (!Number.isFinite(clienteId) || clienteId <= 0) return;

    if (!mapa.has(clienteId)) {
      const mestre = perfil.clienteMestre || (typeof perfil.cliente === 'object' ? perfil.cliente : null);
      const nome = perfil.clienteNome
        || (typeof perfil.cliente === 'string' ? perfil.cliente : null)
        || mestre?.nome
        || `Cliente #${clienteId}`;
      mapa.set(clienteId, {
        clienteId,
        nome,
        telefone: perfil.telefone || mestre?.telefone || '',
        cidade: extrairCidade(mestre || {}, perfil),
        documento: perfil.cpfCnpj || mestre?.documento || mestre?.cpf_cnpj || '',
        codigo: String(perfil.codigo || clienteId),
        perfis: [],
        perfilPrincipal: perfil,
        clienteMestre: mestre,
        raw: perfil.raw
      });
    }

    const grupo = mapa.get(clienteId);
    grupo.perfis.push(perfil);
    if ((perfil.limiteComercial ?? perfil.limite ?? 0) >= (grupo.perfilPrincipal.limiteComercial ?? grupo.perfilPrincipal.limite ?? 0)) {
      grupo.perfilPrincipal = perfil;
    }
  });

  return [...mapa.values()].map((grupo) => ({
    ...grupo,
    capacidades: extrairCapacidadesDosPerfis(grupo.perfis),
    status: resolverStatusCliente(grupo),
    statusVariant: grupo.status === 'Bloqueado' ? 'error' : (grupo.status === 'Inativo' ? 'warning' : 'success')
  }));
}

function enrichClienteCard(grupo, situacao = {}) {
  const consignacoesAbertas = Array.isArray(situacao.consignacoesAbertas)
    ? situacao.consignacoesAbertas.length
    : (situacao.quantidadeConsignacoesAbertas ?? grupo.consignacoesAbertas ?? 0);

  const saldo = Number(
    situacao.saldo
    ?? situacao.saldoEmAberto
    ?? grupo.perfilPrincipal?.saldoUtilizado
    ?? 0
  );

  return {
    ...grupo,
    saldoAtual: saldo,
    consignacoesAbertas,
    situacao
  };
}

function filtrarClientesOperacional(clientes = [], termo = '', filtros = {}) {
  const q = normalizarTextoBusca(termo);
  const qDigits = q.replace(/\D/g, '');

  let resultado = clientes;

  if (q) {
    resultado = resultado.filter((c) => {
      const campos = [
        c.nome,
        c.documento,
        c.telefone,
        c.codigo,
        c.clienteId
      ].map((v) => normalizarTextoBusca(v));

      const textoMatch = campos.some((v) => v.includes(q));
      const docDigits = String(c.documento || '').replace(/\D/g, '');
      const telDigits = String(c.telefone || '').replace(/\D/g, '');
      const digitMatch = qDigits.length >= 3
        && (docDigits.includes(qDigits) || telDigits.includes(qDigits));

      return textoMatch || digitMatch;
    });
  }

  if (filtros.status && filtros.status !== 'todos') {
    resultado = resultado.filter((c) => {
      const status = (c.status || '').toLowerCase();
      return status === filtros.status.toLowerCase();
    });
  }

  if (filtros.capacidade) {
    resultado = resultado.filter((c) =>
      (c.capacidades || []).some((cap) =>
        normalizarTextoBusca(cap).includes(normalizarTextoBusca(filtros.capacidade))
      )
    );
  }

  return resultado;
}

module.exports = {
  groupPerfisByCliente,
  enrichClienteCard,
  filtrarClientesOperacional,
  resolverStatusCliente
};
