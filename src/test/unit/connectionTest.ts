/*
 * Copyright (c) 2016, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as sinon from 'sinon';
import { assert, expect } from 'chai';

import { Connection, SFDX_HTTP_HEADERS } from '../../lib/connection';
import { AuthInfo } from '../../lib/authInfo';
import { Logger } from '../../lib/logger';
import * as jsforce from 'jsforce';
import { testSetup } from '../testSetup';

// Setup the test environment.
const $$ = testSetup();

describe('Connection', () => {

    const testConnectionOptions = { loginUrl: 'connectionTest/loginUrl' };

    const testAuthInfo = {
        isOauth: () => true,
        getConnectionOptions: () => testConnectionOptions
    };

    beforeEach(() => {
        $$.SANDBOX.stub(jsforce.Connection.prototype, 'initialize').returns({});
    });

    it('create() should create a connection using AuthInfo and SFDX options', async () => {
        const conn = await Connection.create(testAuthInfo as any);

        expect(conn.request).to.exist;
        expect(conn['oauth2']).to.be.an('object');
        expect(conn['authInfo']).to.exist;
        expect(conn['loginUrl']).to.equal(testConnectionOptions.loginUrl);
        expect(conn['callOptions']).to.deep.equal({ client: 'sfdx toolbelt:' });
        expect(jsforce.Connection.prototype.initialize['called']).to.be.true;
    });

    it('request() should add SFDX headers and call super() for a URL arg', async () => {
        const testResponse = { success: true };
        $$.SANDBOX.stub(jsforce.Connection.prototype, 'request').returns(Promise.resolve(testResponse));
        const testUrl = 'connectionTest/request/url';
        const expectedRequestInfo = { method: 'GET', url: testUrl, headers: SFDX_HTTP_HEADERS };

        const conn = await Connection.create(testAuthInfo as any);

        // Test passing a string to conn.request()
        const response1 = await conn.request(testUrl);
        expect(jsforce.Connection.prototype.request.called).to.be.true;
        expect(jsforce.Connection.prototype.request['firstCall'].args[0]).to.deep.equal(expectedRequestInfo);
        expect(jsforce.Connection.prototype.request['firstCall'].args[1]).to.be.undefined;
        expect(response1).to.deep.equal(testResponse);
    });

    it('request() should add SFDX headers and call super() for a RequestInfo and options arg', async () => {
        const testResponse = { success: true };
        $$.SANDBOX.stub(jsforce.Connection.prototype, 'request').returns(Promise.resolve(testResponse));
        const testUrl = 'connectionTest/request/url/describe';

        const conn = await Connection.create(testAuthInfo as any);

        // Test passing a RequestInfo object and options to conn.request()
        const requestInfo = { method: 'POST', url: testUrl };
        const expectedRequestInfo = Object.assign({}, requestInfo, { headers: SFDX_HTTP_HEADERS });
        const httpOptions = { responseType: 'json' };
        const response = await conn.request(requestInfo, httpOptions);
        expect(jsforce.Connection.prototype.request.called).to.be.true;
        expect(jsforce.Connection.prototype.request['firstCall'].args[0]).to.deep.equal(expectedRequestInfo);
        expect(jsforce.Connection.prototype.request['firstCall'].args[1]).to.equal(httpOptions);
        expect(response).to.deep.equal(testResponse);
    });
});