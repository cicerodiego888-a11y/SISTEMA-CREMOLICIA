/**
 * Testes do ResultHttpMapper corporativo.
 */

const assert = require('assert');
const Result = require('../../backend/motores/motor-comercial/infrastructure/result/Result');
const ResultHttpMapper = require('../../backend/shared/http/mappers/ResultHttpMapper');

function testMapOkWithDados() {
  const result = Result.ok({ perfil: { id: 1, clienteId: 42, perfilTipo: 'CONSIGNADO' }, correlationId: 'c-1' });
  const response = ResultHttpMapper.mapCreated(result);

  assert.strictEqual(response.success, true);
  assert.strictEqual(response.data.perfil.id, 1);
  assert.strictEqual(response.data.perfil.clienteId, 42);
  assert.strictEqual(response.data.correlationId, 'c-1');
  assert.strictEqual(response._statusCode, 201);
}

function testMapFail() {
  const result = Result.fail(new Error('Falha de teste'));
  const response = ResultHttpMapper.map(result);

  assert.strictEqual(response.success, false);
  assert.ok(response.error);
}

function testMapCreatedDoesNotForce201OnFailure() {
  const result = Result.fail(new Error('Falha de criação'));
  const response = ResultHttpMapper.mapCreated(result);

  assert.strictEqual(response.success, false);
  assert.notStrictEqual(response._statusCode, 201);
}

function run() {
  testMapOkWithDados();
  testMapFail();
  testMapCreatedDoesNotForce201OnFailure();
  console.log('result-http-mapper.test.js: OK');
}

run();
