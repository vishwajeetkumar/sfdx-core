/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { lookup } from 'dns';
import { URL } from 'url';
import { promisify } from 'util';
import { ensureString } from '@salesforce/ts-types';
import { AsyncOptionalCreatable, Duration } from '@salesforce/kit';
import { Logger } from '../logger';
import { PollingClient } from './pollingClient';
/**
 * A class used to resolve MyDomains. After a ScratchOrg is created it's host name my not be propagated to the
 * Salesforce DNS service. This service is not exclusive to Salesforce My Domain URL and could be used for any hostname.
 *
 * ```
 * (async () => {
 *  const options: MyDomainResolver.Options = {
 *      url: new URL('http://mydomain.salesforce.com'),
 *      timeout: Duration.minutes(5),
 *      frequency: Duration.seconds(10)
 *  };
 *  const resolver: MyDomainResolver = await MyDomainResolver.create(options);
 *  const ipAddress: AnyJson = await resolver.resolve();
 *  console.log(`Successfully resolved host: ${options.url} to address: ${ipAddress}`);
 * })();
 * ```
 */
export class MyDomainResolver extends AsyncOptionalCreatable {
  constructor(options) {
    super(options);
    this.options = options || { url: MyDomainResolver.DEFAULT_DOMAIN };
  }
  /**
   * Method that performs the dns lookup of the host. If the lookup fails the internal polling client will try again
   * given the optional interval. Returns the resolved ip address.
   */
  async resolve() {
    const self = this;
    const pollingOptions = {
      async poll() {
        const host = self.options.url.host;
        let dnsResult;
        try {
          self.logger.debug(`Attempting to resolve url: ${host}`);
          if (host && host.includes('.internal.salesforce.com')) {
            return {
              completed: true,
              payload: '127.0.0.1'
            };
          }
          dnsResult = await promisify(lookup)(host);
          self.logger.debug(`Successfully resolved host: ${host} result: ${JSON.stringify(dnsResult)}`);
          return {
            completed: true,
            payload: dnsResult.address
          };
        } catch (e) {
          self.logger.debug(`An error occurred trying to resolve: ${host}`);
          self.logger.debug(`Error: ${e.message}`);
          self.logger.debug('Re-trying dns lookup again....');
          return {
            completed: false
          };
        }
      },
      timeout: this.options.timeout || Duration.seconds(30),
      frequency: this.options.frequency || Duration.seconds(10),
      timeoutErrorName: 'MyDomainResolverTimeoutError'
    };
    const client = await PollingClient.create(pollingOptions);
    return ensureString(await client.subscribe());
  }
  /**
   * Used to initialize asynchronous components.
   */
  async init() {
    this.logger = await Logger.child('MyDomainResolver');
  }
}
MyDomainResolver.DEFAULT_DOMAIN = new URL('https://login.salesforce.com');
//# sourceMappingURL=myDomainResolver.js.map