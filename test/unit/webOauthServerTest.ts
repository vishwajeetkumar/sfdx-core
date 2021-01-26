/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as http from 'http';
import { expect } from 'chai';

import { assert } from '@salesforce/ts-types';
import { StubbedType, stubInterface, stubMethod } from '@salesforce/ts-sinon';
import { Env } from '@salesforce/kit';
import { testSetup, MockTestOrgData } from '../../src/testSetup';
import { SfdxProjectJson } from '../../src/sfdxProject';
import { WebOAuthServer, WebServer } from '../../src/webOAuthServer';
import { AuthFields, AuthInfo } from '../../src/authInfo';

const $$ = testSetup();

describe('WebOauthServer', () => {
  describe('determineOauthPort', () => {
    it('should return configured oauth port if it exists', async () => {
      $$.SANDBOX.stub(SfdxProjectJson.prototype, 'get').withArgs('oauthLocalPort').returns(8080);
      const port = await WebOAuthServer.determineOauthPort();
      expect(port).to.equal(8080);
    });

    it('should return default oauth port if no configured value exists', async () => {
      const port = await WebOAuthServer.determineOauthPort();
      expect(port).to.equal(WebOAuthServer.DEFAULT_PORT);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should return authorization url', async () => {
      const oauthServer = await WebOAuthServer.create({ oauthConfig: {} });
      const authUrl = oauthServer.getAuthorizationUrl();
      expect(authUrl).to.not.be.undefined;
      expect(authUrl).to.include('client_id=PlatformCLI');
    });
  });

  describe('authorizeAndSave', () => {
    const testData = new MockTestOrgData();
    const frontDoorUrl = 'https://www.frontdoor.com';
    let authFields: AuthFields;
    let authInfoStub: StubbedType<AuthInfo>;
    let serverResponseStub: StubbedType<http.ServerResponse>;
    let redirectStub: sinon.SinonStub;
    let authStub: sinon.SinonStub;

    beforeEach(async () => {
      authFields = await testData.getConfig();
      authInfoStub = stubInterface<AuthInfo>($$.SANDBOX, {
        getFields: () => authFields,
        getOrgFrontDoorUrl: () => frontDoorUrl,
      });
      serverResponseStub = stubInterface<http.ServerResponse>($$.SANDBOX, {});

      stubMethod($$.SANDBOX, WebOAuthServer.prototype, 'executeOauthRequest').callsFake(async () => serverResponseStub);
      authStub = stubMethod($$.SANDBOX, AuthInfo, 'create').callsFake(async () => authInfoStub);
      redirectStub = stubMethod($$.SANDBOX, WebServer.prototype, 'doRedirect').callsFake(async () => {});
    });

    it('should save new AuthInfo', async () => {
      const oauthServer = await WebOAuthServer.create({ oauthConfig: {} });
      await oauthServer.start();
      const authInfo = await oauthServer.authorizeAndSave();
      expect(authInfoStub.save.callCount).to.equal(1);
      expect(authInfo.getFields()).to.deep.equal(authFields);
    });

    it('should redirect to front door url', async () => {
      const oauthServer = await WebOAuthServer.create({ oauthConfig: {} });
      await oauthServer.start();
      await oauthServer.authorizeAndSave();
      expect(redirectStub.callCount).to.equal(1);
      expect(redirectStub.args).to.deep.equal([[303, frontDoorUrl, serverResponseStub]]);
    });

    it('should report error', async () => {
      const reportErrorStub = stubMethod($$.SANDBOX, WebServer.prototype, 'reportError').callsFake(async () => {});
      authStub.rejects(new Error('BAD ERROR'));
      const oauthServer = await WebOAuthServer.create({ oauthConfig: {} });
      await oauthServer.start();
      try {
        await oauthServer.authorizeAndSave();
        assert(false, 'authorizeAndSave should fail');
      } catch (e) {
        expect(e.message, 'BAD ERROR');
      }
      expect(authStub.callCount).to.equal(1);
      expect(reportErrorStub.args[0][0].message).to.equal('BAD ERROR');
    });
  });

  describe('parseAuthCodeFromRequest', () => {
    const authCode = 'abc123456';
    let serverResponseStub: StubbedType<http.ServerResponse>;
    let serverRequestStub: StubbedType<WebOAuthServer.Request>;

    beforeEach(async () => {
      serverResponseStub = stubInterface<http.ServerResponse>($$.SANDBOX, {});
      serverRequestStub = stubInterface<WebOAuthServer.Request>($$.SANDBOX, {
        query: { code: authCode },
      });
    });

    it('should return auth code from the request', async () => {
      stubMethod($$.SANDBOX, WebOAuthServer.prototype, 'validateState').returns(true);
      const oauthServer = await WebOAuthServer.create({ oauthConfig: {} });
      // @ts-ignore because private member
      const code = oauthServer.parseAuthCodeFromRequest(serverResponseStub, serverRequestStub);
      expect(code).to.equal(authCode);
    });

    it('should close the request when state is not valid', async () => {
      stubMethod($$.SANDBOX, WebOAuthServer.prototype, 'validateState').returns(false);
      const closeStub = stubMethod($$.SANDBOX, WebOAuthServer.prototype, 'closeRequest').returns(null);
      const sendErrorStub = stubMethod($$.SANDBOX, WebServer.prototype, 'sendError').returns(null);
      const oauthServer = await WebOAuthServer.create({ oauthConfig: {} });
      // @ts-ignore because private member
      oauthServer.parseAuthCodeFromRequest(serverResponseStub, serverRequestStub);
      expect(closeStub.callCount).to.equal(1);
      expect(sendErrorStub.callCount).to.equal(1);
    });
  });

  describe('validateState', () => {
    it('should return false when state params do not match', async () => {
      const serverRequestStub = stubInterface<WebOAuthServer.Request>($$.SANDBOX, {
        query: { state: 'abc123456' },
      });
      const oauthServer = await WebOAuthServer.create({ oauthConfig: {} });
      // @ts-ignore because private member
      const actual = oauthServer.validateState(serverRequestStub);
      expect(actual).to.equal(false);
    });

    it('should return true when state params do match', async () => {
      const serverRequestStub = stubInterface<WebOAuthServer.Request>($$.SANDBOX, {
        query: { state: 'abc123456' },
      });
      const oauthServer = await WebOAuthServer.create({ oauthConfig: {} });
      // @ts-ignore because private member
      oauthServer.authUrl = 'http://login.salesforce.com?state=abc123456';
      // @ts-ignore because private member
      const actual = oauthServer.validateState(serverRequestStub);
      expect(actual).to.equal(true);
    });
  });
});

describe('WebServer', () => {
  describe('checkOsPort', () => {
    it('should return the port if port is not in use', async () => {
      const server = await WebServer.create({});
      // @ts-ignore because private member
      const port = await server.checkOsPort();
      expect(port).to.equal(WebOAuthServer.DEFAULT_PORT);
    });

    it('should throw an error if the port is in use', async () => {
      const existingServer = await WebServer.create({});
      await existingServer.start();
      const newServer = await WebServer.create({});
      try {
        // @ts-ignore because private member
        await newServer.checkOsPort();
      } catch (err) {
        expect(err.name).to.include('EADDRINUSE');
      } finally {
        existingServer.close();
      }
    });

    it('should throw an error if it times out', async () => {
      stubMethod($$.SANDBOX, WebServer.prototype, 'getSocketTimeout').returns(0);
      const server = await WebServer.create({});
      try {
        // @ts-ignore because private member
        await server.checkOsPort();
      } catch (err) {
        expect(err.name).to.include('SOCKET_TIMEOUT');
      }
    });
  });

  describe('getSocketTimeout', () => {
    it('should return default timeout when env var does not exist', async () => {
      const server = await WebServer.create({});
      // @ts-ignore because private member
      const timeout = server.getSocketTimeout();
      expect(timeout).to.equal(WebServer.DEFAULT_CLIENT_SOCKET_TIMEOUT);
    });

    it('should return env var value for timeout when env var does exist', async () => {
      stubMethod($$.SANDBOX, Env.prototype, 'getNumber').returns(5000);
      const server = await WebServer.create({});
      // @ts-ignore because private member
      const timeout = server.getSocketTimeout();
      expect(timeout).to.equal(5000);
    });

    it('should return default timeout when env var is invalid value', async () => {
      stubMethod($$.SANDBOX, Env.prototype, 'getNumber').returns('foo');
      const server = await WebServer.create({});
      // @ts-ignore because private member
      const timeout = server.getSocketTimeout();
      expect(timeout).to.equal(WebServer.DEFAULT_CLIENT_SOCKET_TIMEOUT);
    });

    it('should return default timeout when env var is 0', async () => {
      stubMethod($$.SANDBOX, Env.prototype, 'getNumber').returns(0);
      const server = await WebServer.create({});
      // @ts-ignore because private member
      const timeout = server.getSocketTimeout();
      expect(timeout).to.equal(WebServer.DEFAULT_CLIENT_SOCKET_TIMEOUT);
    });
  });
});
