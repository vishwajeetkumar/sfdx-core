/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { get, JsonMap } from '@salesforce/ts-types';

import { assert, expect } from 'chai';
import * as jsforce from 'jsforce';
import { AuthInfo } from '../../src/authInfo';
import { MyDomainResolver } from '../../src/status/myDomainResolver';
import { ConfigAggregator, ConfigInfo } from '../../src/config/configAggregator';
import { Connection, SFDX_HTTP_HEADERS, DNS_ERROR_NAME, SingleRecordQueryErrors } from '../../src/connection';
import { testSetup, shouldThrow } from '../../src/testSetup'

// Setup the test environment.
const $$ = testSetup();
const TEST_IP = '1.1.1.1';

describe('Connection', () => {
  const testConnectionOptions = { loginUrl: 'connectionTest/loginUrl' };

  let requestMock: sinon.SinonStub;
  let initializeStub: sinon.SinonStub;

  const testAuthInfo = {
    isOauth: () => true,
    getConnectionOptions: () => testConnectionOptions,
  };

  const testAuthInfoWithDomain = {
    ...testAuthInfo,
    getConnectionOptions: () => ({
      ...testConnectionOptions,
      instanceUrl: 'https://connectionTest/instanceUrl',
    }),
  };

  beforeEach(() => {
    $$.SANDBOXES.CONNECTION.restore();
    $$.SANDBOX.stub(process, 'emitWarning');
    $$.SANDBOX.stub(MyDomainResolver.prototype, 'resolve').resolves(TEST_IP);

    initializeStub = $$.SANDBOX.stub(jsforce.Connection.prototype, 'initialize').returns();
    requestMock = $$.SANDBOX.stub(jsforce.Connection.prototype, 'request')
      .onFirstCall()
      .returns(Promise.resolve([{ version: '42.0' }]));
  });

  it('create() should throw on DNS errors', async () => {
    $$.SANDBOX.restore();
    $$.SANDBOX.stub(MyDomainResolver.prototype, 'resolve').rejects({ name: DNS_ERROR_NAME });

    try {
      await shouldThrow(Connection.create({ authInfo: testAuthInfoWithDomain as AuthInfo }));
    } catch (e) {
      expect(e).to.have.property('name', DNS_ERROR_NAME);
    }
  });

  it('create() should create a connection using AuthInfo and SFDX options', async () => {
    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });

    expect(conn.request).to.exist;
    expect(conn['oauth2']).to.be.an('object');
    expect(get(conn, 'options.authInfo')).to.exist;
    expect(get(conn, 'loginUrl')).to.equal(testConnectionOptions.loginUrl);
    expect((get(conn, 'callOptions') as JsonMap).client).to.contain('sfdx toolbelt:');
    expect(initializeStub.called).to.be.true;
  });

  it('create() should create a connection with the latest API version', async () => {
    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });
    expect(conn.getApiVersion()).to.equal('42.0');
  });

  it('setApiVersion() should throw with invalid version', async () => {
    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });

    try {
      conn.setApiVersion('v23.0');
      assert.fail();
    } catch (e) {
      expect(e.message).to.contain('Invalid API version v23.0.');
    }
  });

  it('request() should add SFDX headers and call super() for a URL arg', async () => {
    const testResponse = { success: true };
    requestMock.onSecondCall().returns(Promise.resolve(testResponse));
    const testUrl = 'connectionTest/request/url';
    const expectedRequestInfo = {
      method: 'GET',
      url: testUrl,
      headers: SFDX_HTTP_HEADERS,
    };

    const conn = await Connection.create({
      authInfo: testAuthInfoWithDomain as AuthInfo,
    });
    // Test passing a string to conn.request()
    const response1 = await conn.request(testUrl);
    expect(requestMock.called).to.be.true;
    expect(requestMock.secondCall.args[0]).to.deep.equal(expectedRequestInfo);
    expect(requestMock.secondCall.args[1]).to.be.undefined;
    expect(response1).to.deep.equal(testResponse);
  });

  it('request() should add SFDX headers and call super() for a RequestInfo and options arg', async () => {
    const testResponse = { success: true };
    requestMock.onSecondCall().returns(Promise.resolve(testResponse));
    const testUrl = 'connectionTest/request/url/describe';

    const conn = await Connection.create({
      authInfo: testAuthInfoWithDomain as AuthInfo,
    });

    // Test passing a RequestInfo object and options to conn.request()
    const requestInfo = { method: 'POST', url: testUrl };
    const expectedRequestInfo = Object.assign({}, requestInfo, {
      headers: SFDX_HTTP_HEADERS,
    });
    const httpOptions = { responseType: 'json' };
    const response = await conn.request(requestInfo, httpOptions);
    expect(requestMock.called).to.be.true;
    expect(requestMock.secondCall.args[0]).to.deep.equal(expectedRequestInfo);
    expect(requestMock.secondCall.args[1]).to.equal(httpOptions);
    expect(response).to.deep.equal(testResponse);
  });

  it('request() should add SFDX headers and call super() for a tooling request', async () => {
    const testResponse = { success: true };
    requestMock.onSecondCall().returns(Promise.resolve(testResponse));

    const conn = await Connection.create({
      authInfo: testAuthInfoWithDomain as AuthInfo,
    });

    const testUrl = '/services/data/v42.0/tooling/sobjects';
    const requestInfo = { method: 'GET', url: testUrl };
    const expectedRequestInfo = Object.assign({}, requestInfo, {
      headers: SFDX_HTTP_HEADERS,
    });

    const response = await conn.tooling.describeGlobal();

    expect(requestMock.called).to.be.true;
    expect(requestMock.secondCall.args[0]).to.deep.equal(expectedRequestInfo);
    expect(response).to.deep.equal(testResponse);
  });

  it('autoFetchQuery() should call this.query with proper args', async () => {
    const records = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }];
    const queryResponse = { totalSize: records.length, done: true, records };
    requestMock.onSecondCall().returns(Promise.resolve(queryResponse));
    const querySpy = $$.SANDBOX.spy(jsforce.Connection.prototype, 'query');
    const soql = 'TEST_SOQL';

    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });
    const queryResults = await conn.autoFetchQuery(soql);

    expect(queryResults).to.deep.equal({
      done: true,
      totalSize: 6,
      records: [...records],
    });
    expect(querySpy.firstCall.args[0]).to.equal(soql);
    expect(querySpy.firstCall.args[1]).to.have.property('autoFetch', true);
  });

  it('tooling.autoFetchQuery() should call this.query with proper args', async () => {
    const records = [{ id: 7 }, { id: 8 }, { id: 9 }, { id: 10 }, { id: 11 }, { id: 12 }];
    const queryResponse = { totalSize: records.length, done: true, records };
    requestMock.onSecondCall().returns(Promise.resolve(queryResponse));
    const soql = 'TEST_SOQL';

    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });
    const toolingQuerySpy = $$.SANDBOX.spy(conn.tooling, 'query');
    const queryResults = await conn.tooling.autoFetchQuery(soql);

    expect(queryResults).to.deep.equal({
      done: true,
      totalSize: 6,
      records: [...records],
    });
    expect(toolingQuerySpy.firstCall.args[0]).to.equal(soql);
    expect(toolingQuerySpy.firstCall.args[1]).to.have.property('autoFetch', true);
  });

  it('tooling.autoFetchQuery() should respect the maxQueryLimit config variable', async () => {
    const soql = 'TEST_SOQL';

    const records = [{ id: 7 }, { id: 8 }, { id: 10 }, { id: 11 }, { id: 12 }];
    const queryResponse = { totalSize: 50000, done: true, records };
    requestMock.returns(Promise.resolve(queryResponse));

    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });
    const toolingQuerySpy = $$.SANDBOX.spy(conn.tooling, 'query');
    $$.SANDBOX.stub(ConfigAggregator.prototype, 'getInfo').returns({ value: 50000 } as ConfigInfo);
    await conn.tooling.autoFetchQuery(soql);

    expect(toolingQuerySpy.firstCall.args[0]).to.equal(soql);
    expect(toolingQuerySpy.firstCall.args[1]).to.have.property('autoFetch', true);
    expect(toolingQuerySpy.firstCall.args[1]).to.have.property('maxFetch', 50000);
  });

  it('tooling.autoFetchQuery() should throw a warning when more than 10k records returned without the config', async () => {
    const soql = 'TEST_SOQL';

    const records = [{ id: 7 }, { id: 8 }, { id: 10 }, { id: 11 }, { id: 12 }];
    const queryResponse = { totalSize: 5, done: true, records };
    requestMock.returns(Promise.resolve(queryResponse));

    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });
    const toolingQuerySpy = $$.SANDBOX.spy(conn.tooling, 'query');
    $$.SANDBOX.stub(ConfigAggregator.prototype, 'getInfo').returns({ value: 3 } as ConfigInfo);
    await conn.tooling.autoFetchQuery(soql);

    expect(toolingQuerySpy.firstCall.args[0]).to.equal(soql);
    expect(toolingQuerySpy.firstCall.args[1]).to.have.property('autoFetch', true);
    expect(toolingQuerySpy.firstCall.args[1]).to.have.property('maxFetch', 3);
  });

  it('autoFetch() should reject the promise upon query error', async () => {
    const errorMsg = 'QueryFailed';
    requestMock.onSecondCall().throws(new Error(errorMsg));
    const conn = await Connection.create({
      authInfo: testAuthInfoWithDomain as AuthInfo,
    });

    try {
      await conn.autoFetchQuery('TEST_SOQL');
      assert.fail('autoFetch query should have errored.');
    } catch (err) {
      expect(err.message).to.equal(errorMsg);
    }
  });

  it('singleRecordQuery returns single-record result properly', async () => {
    const mockSingleRecord = {
      id: '123',
      name: 'testName',
    };
    requestMock.returns(Promise.resolve({ totalSize: 1, records: [mockSingleRecord] }));
    const soql = 'TEST_SOQL';

    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });
    const queryResult = await conn.singleRecordQuery(soql);
    expect(queryResult).to.deep.equal({
      ...mockSingleRecord,
    });
  });

  it('singleRecordQuery throws on no-records', async () => {
    requestMock.returns(Promise.resolve({ totalSize: 0, records: [] }));
    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });

    try {
      await conn.singleRecordQuery('TEST_SOQL');
      assert.fail('SingleRecordQuery query should have errored.');
    } catch (err) {
      expect(err.name).to.equal(SingleRecordQueryErrors.NoRecords);
    }
  });

  it('singleRecordQuery throws on multiple records', async () => {
    requestMock.returns(Promise.resolve({ totalSize: 2, records: [{ id: 1 }, { id: 2 }] }));
    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });

    try {
      await conn.singleRecordQuery('TEST_SOQL');
      assert.fail('singleRecordQuery should have errored.');
    } catch (err) {
      expect(err.name).to.equal(SingleRecordQueryErrors.MultipleRecords);
    }
  });

  it('singleRecordQuery throws on multiple records with options', async () => {
    requestMock.returns(Promise.resolve({ totalSize: 2, records: [{ id: 1 }, { id: 2 }] }));
    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });

    try {
      await conn.singleRecordQuery('TEST_SOQL', { returnChoicesOnMultiple: true, choiceField: 'id' });
      assert.fail('singleRecordQuery should have errored.');
    } catch (err) {
      expect(err.name).to.equal(SingleRecordQueryErrors.MultipleRecords);
      expect(err.message).to.include('1,2');
    }
  });

  it('singleRecordQuery handles tooling api flag', async () => {
    const mockSingleRecord = {
      id: '123',
      name: 'testName',
    };
    requestMock.returns(Promise.resolve({ totalSize: 1, records: [mockSingleRecord] }));
    const soql = 'TEST_SOQL';

    const conn = await Connection.create({ authInfo: testAuthInfo as AuthInfo });
    const toolingQuerySpy = $$.SANDBOX.spy(conn.tooling, 'query');
    const queryResults = await conn.singleRecordQuery(soql, { tooling: true });
    expect(queryResults).to.deep.equal({
      ...mockSingleRecord,
    });
    expect(toolingQuerySpy.firstCall.args[0]).to.equal(soql);
  });
});
