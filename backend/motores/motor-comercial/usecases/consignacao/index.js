/**
 * Casos de Uso do Aggregate Consignacao
 *
 * @module motores/motor-comercial/usecases/consignacao
 */

const CriarConsignacaoUseCase = require('./CriarConsignacaoUseCase');
const EditarConsignacaoUseCase = require('./EditarConsignacaoUseCase');
const CancelarConsignacaoRascunhoUseCase = require('./CancelarConsignacaoRascunhoUseCase');
const AdicionarItemConsignacaoUseCase = require('./AdicionarItemConsignacaoUseCase');
const RemoverItemConsignacaoUseCase = require('./RemoverItemConsignacaoUseCase');
const AlterarQuantidadeItemUseCase = require('./AlterarQuantidadeItemUseCase');
const ConsultarConsignacaoUseCase = require('./ConsultarConsignacaoUseCase');
const ListarConsignacoesUseCase = require('./ListarConsignacoesUseCase');
const ConsultarItensConsignacaoUseCase = require('./ConsultarItensConsignacaoUseCase');
const ValidarConsignacaoUseCase = require('./ValidarConsignacaoUseCase');
const ValidarEntregaConsignacaoUseCase = require('./ValidarEntregaConsignacaoUseCase');
const RegistrarEntregaConsignacaoUseCase = require('./RegistrarEntregaConsignacaoUseCase');
const RegistrarEntregaComplementarUseCase = require('./RegistrarEntregaComplementarUseCase');
const RegistrarAlteracaoPosEntregaUseCase = require('./RegistrarAlteracaoPosEntregaUseCase');
const RegistrarDevolucaoAntesPrestacaoUseCase = require('./RegistrarDevolucaoAntesPrestacaoUseCase');
const TransferirItensEntreConsignacoesUseCase = require('./TransferirItensEntreConsignacoesUseCase');
const ConfirmarRecebimentoConsignacaoUseCase = require('./ConfirmarRecebimentoConsignacaoUseCase');
const ConsultarOperacaoConsignacaoUseCase = require('./ConsultarOperacaoConsignacaoUseCase');
const ConsultarMovimentacoesConsignacaoUseCase = require('./ConsultarMovimentacoesConsignacaoUseCase');
const ConsultarConsignacoesEmTransitoUseCase = require('./ConsultarConsignacoesEmTransitoUseCase');
const AbrirPrestacaoUseCase = require('./AbrirPrestacaoUseCase');
const RegistrarVendaPrestacaoUseCase = require('./RegistrarVendaPrestacaoUseCase');
const RegistrarPerdaUseCase = require('./RegistrarPerdaUseCase');
const DefinirRateioPerdaUseCase = require('./DefinirRateioPerdaUseCase');
const ConsultarRateioPerdaUseCase = require('./ConsultarRateioPerdaUseCase');
const RegistrarCortesiaUseCase = require('./RegistrarCortesiaUseCase');
const RegistrarPagamentoPrestacaoUseCase = require('./RegistrarPagamentoPrestacaoUseCase');
const FecharPrestacaoUseCase = require('./FecharPrestacaoUseCase');
const ReabrirPrestacaoUseCase = require('./ReabrirPrestacaoUseCase');
const ConsultarPrestacaoUseCase = require('./ConsultarPrestacaoUseCase');
const ConsultarResumoPrestacaoUseCase = require('./ConsultarResumoPrestacaoUseCase');
const RegistrarEmissaoTermoEntregaUseCase = require('./RegistrarEmissaoTermoEntregaUseCase');
const FinalizarPrestacaoComVendaOficialUseCase = require('./FinalizarPrestacaoComVendaOficialUseCase');
const EmitirNfcePrestacaoUseCase = require('./EmitirNfcePrestacaoUseCase');
const PosNfcePrestacaoUseCase = require('./PosNfcePrestacaoUseCase');

module.exports = {
  CriarConsignacaoUseCase,
  EditarConsignacaoUseCase,
  CancelarConsignacaoRascunhoUseCase,
  AdicionarItemConsignacaoUseCase,
  RemoverItemConsignacaoUseCase,
  AlterarQuantidadeItemUseCase,
  ConsultarConsignacaoUseCase,
  ListarConsignacoesUseCase,
  ConsultarItensConsignacaoUseCase,
  ValidarConsignacaoUseCase,
  ValidarEntregaConsignacaoUseCase,
  RegistrarEntregaConsignacaoUseCase,
  RegistrarEntregaComplementarUseCase,
  RegistrarAlteracaoPosEntregaUseCase,
  RegistrarDevolucaoAntesPrestacaoUseCase,
  TransferirItensEntreConsignacoesUseCase,
  ConfirmarRecebimentoConsignacaoUseCase,
  ConsultarOperacaoConsignacaoUseCase,
  ConsultarMovimentacoesConsignacaoUseCase,
  ConsultarConsignacoesEmTransitoUseCase,
  AbrirPrestacaoUseCase,
  RegistrarVendaPrestacaoUseCase,
  RegistrarPerdaUseCase,
  DefinirRateioPerdaUseCase,
  ConsultarRateioPerdaUseCase,
  RegistrarCortesiaUseCase,
  RegistrarPagamentoPrestacaoUseCase,
  FecharPrestacaoUseCase,
  ReabrirPrestacaoUseCase,
  ConsultarPrestacaoUseCase,
  ConsultarResumoPrestacaoUseCase,
  RegistrarEmissaoTermoEntregaUseCase,
  FinalizarPrestacaoComVendaOficialUseCase,
  EmitirNfcePrestacaoUseCase,
  PosNfcePrestacaoUseCase
};
