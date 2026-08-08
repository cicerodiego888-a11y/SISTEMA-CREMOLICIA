/**
 * CanaisVendaService — Regras de negócio de canais de venda (RCM-04.1)
 */

const canaisVendaRepository = require('./CanaisVendaRepository');

const CODIGOS_SISTEMA = new Set(['VAREJO', 'ATACADO', 'EVENTO']);

function validarPayload(dados, { parcial = false } = {}) {
  if (!parcial || dados.codigo !== undefined) {
    const codigo = String(dados.codigo || '').trim();
    if (!codigo) {
      const err = new Error('Código é obrigatório');
      err.statusCode = 400;
      throw err;
    }
  }
  if (!parcial || dados.nome !== undefined) {
    const nome = String(dados.nome || '').trim();
    if (!nome) {
      const err = new Error('Nome é obrigatório');
      err.statusCode = 400;
      throw err;
    }
  }
}

class CanaisVendaService {
  async listar(filtros = {}) {
    const apenasAtivos = filtros.ativos === '1' || filtros.ativos === true;
    return canaisVendaRepository.listar({ apenasAtivos });
  }

  async buscarPorId(id) {
    return canaisVendaRepository.buscarPorId(id);
  }

  async criar(dados) {
    validarPayload(dados);
    try {
      return await canaisVendaRepository.criar({
        codigo: dados.codigo,
        nome: dados.nome,
        ativo: dados.ativo !== undefined ? !!dados.ativo : true
      });
    } catch (error) {
      if (error.message && /UNIQUE/i.test(error.message)) {
        const err = new Error('Já existe um canal com este código');
        err.statusCode = 400;
        throw err;
      }
      throw error;
    }
  }

  async atualizar(id, dados) {
    const existente = await canaisVendaRepository.buscarPorId(id);
    if (!existente) {
      const err = new Error('Canal de venda não encontrado');
      err.statusCode = 404;
      throw err;
    }

    validarPayload(dados, { parcial: true });

    if (
      dados.codigo !== undefined &&
      CODIGOS_SISTEMA.has(String(existente.codigo).toUpperCase()) &&
      String(dados.codigo).trim().toUpperCase() !== String(existente.codigo).toUpperCase()
    ) {
      const err = new Error('Não é permitido alterar o código de canais do sistema');
      err.statusCode = 400;
      throw err;
    }

    try {
      return await canaisVendaRepository.atualizar(id, dados);
    } catch (error) {
      if (error.message && /UNIQUE/i.test(error.message)) {
        const err = new Error('Já existe um canal com este código');
        err.statusCode = 400;
        throw err;
      }
      throw error;
    }
  }

  async excluir(id) {
    const existente = await canaisVendaRepository.buscarPorId(id);
    if (!existente) {
      const err = new Error('Canal de venda não encontrado');
      err.statusCode = 404;
      throw err;
    }

    if (CODIGOS_SISTEMA.has(String(existente.codigo).toUpperCase())) {
      const err = new Error('Não é possível excluir canais padrão do sistema (VAREJO, ATACADO, EVENTO)');
      err.statusCode = 400;
      throw err;
    }

    return canaisVendaRepository.excluir(id);
  }
}

module.exports = new CanaisVendaService();
