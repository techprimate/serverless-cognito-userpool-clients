import * as AWS from 'aws-sdk';
import { CognitoIdentityServiceProvider } from 'aws-sdk';
import chalk from 'chalk';
import { Serverless } from '../typings/serverless';
import { ISLSCognitoClient } from './ISLSCognitoClient';

export class CognitoClientsPlugin {
  public hooks: {};
  public provider: Serverless.Provider.Aws;
  public commands: {};

  private readonly stage: string;
  private readonly region: string;

  constructor(private serverless: Serverless) {
    this.serverless = serverless;

    this.provider = this.serverless.getProvider('aws');
    this.stage = this.provider.getStage();
    this.region = this.provider.getRegion();

    AWS.config.update({
      region: this.region,
    });

    this.hooks = {
      'after:aws:package:finalize:mergeCustomProviderResources': this.addOutputs.bind(this),
      'after:deploy:deploy': this.afterDeploy.bind(this),
      'cognito_clients:deploy:deploy': this.afterDeploy.bind(this),

      // remove
      'before:remove:remove': this.beforeRemove.bind(this),

    };
    this.commands = {
      cognito_clients: {
        commands: {
          deploy: {
            lifecycleEvents: [
              'deploy',
            ],
            usage: 'Deploys a domain using the domain name defined in the serverless file',
          },
        },
        lifecycleEvents: [
          'deploy',
        ],
      },
    };
  }

  private async beforeRemove() {
    this.pluginLog('process_remove started.');
    const custom = this.serverless.service.custom;
    if (!custom) {
      return;
    }
    const configs = this.serverless.service.custom.cognitoClients;
    if (!configs || !Array.isArray(configs)) {
      return;
    }

    for (const config of configs) {
      if (config.customDomain) {
        await this.deleteUserPoolDomain(config.userPoolId, config.customDomain.name);
      }
    }
  }

  private async afterDeploy() {
    const custom = this.serverless.service.custom;
    if (!custom) {
      return;
    }
    const configs = this.serverless.service.custom.cognitoClients;
    if (!configs || !Array.isArray(configs)) {
      return;
    }

    for (const config of configs) {
      await this.updateClient(config);
      await this.updateDomain(config);
    }
  }

  private async updateClient(config: ISLSCognitoClient) {
    const params = {
      AllowedOAuthFlows: config.allowedOAuthFlows,
      AllowedOAuthFlowsUserPoolClient: config.allowedOAuthFlowsUserPoolClient,
      AllowedOAuthScopes: config.allowedOAuthScopes,
      CallbackURLs: config.callbackUrls,
      ClientId: config.clientId,
      LogoutURLs: config.logoutUrls,
      SupportedIdentityProviders: config.supportedIdentityProviders,
      UserPoolId: config.userPoolId,
    };
    const result = await this.provider.request(
      'CognitoIdentityServiceProvider',
      'updateUserPoolClient',
      params,
      this.stage,
      this.region,
    );
    if (result.error) {
      return this.pluginLog(result.error);
    }
    this.pluginLog('Updated Cognito User Pool Client: ' + config.clientId);
  }

  private async updateDomain(config: ISLSCognitoClient) {
    const userPool = await this.describeUserPool(config.userPoolId);
    if (!userPool.CustomDomain && !config.customDomain) { // no domain created nor given
      return;
    }
    if (!userPool.Id) {
      throw new Error('User Pool has no id: ' + userPool);
    }
    if (userPool.CustomDomain && !config.customDomain) {// Delete remote
      await this.deleteUserPoolDomain(userPool.Id, userPool.CustomDomain);
    } else if (config.customDomain && !userPool.CustomDomain) { // Create remote
      await this.createUserPoolDomain(config.userPoolId, config.customDomain.name, config.customDomain.certificateArn);
    } else { // Update remote
      if (!config.customDomain || !userPool.CustomDomain) {
        return;
      }
      if (userPool.CustomDomain !== config.customDomain.name) {
        await this.deleteUserPoolDomain(userPool.Id, userPool.CustomDomain);
        await this.createUserPoolDomain(config.userPoolId,
          config.customDomain.name,
          config.customDomain.certificateArn);
      } else {
        const userPoolDomain = await this.describeUserPoolDomain(config.customDomain.name);

        if (userPoolDomain &&
          userPoolDomain.CustomDomainConfig &&
          userPoolDomain.CustomDomainConfig.CertificateArn !== config.customDomain.certificateArn) {
          await this.updateUserPoolDomain(
            config.userPoolId,
            config.customDomain.name,
            config.customDomain.certificateArn);
        }
      }
    }
  }

  private async describeUserPool(id: string): Promise<CognitoIdentityServiceProvider.Types.UserPoolType> {
    const params: CognitoIdentityServiceProvider.Types.DescribeUserPoolRequest = {
      UserPoolId: id,
    };
    const result = await this.provider.request(
      'CognitoIdentityServiceProvider',
      'describeUserPool',
      params,
      this.stage,
      this.region,
    );
    return result.UserPool;
  }

  private pluginLog(msg: any) {
    this.serverless.cli.log(`${chalk.yellow('Plugin [cognito-userpool-clients]')}: ${msg}`);
  }

  /**
   * Outputs
   */
  private async addOutputs() {
    const resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
    for (const key in resources) {
      if (resources.hasOwnProperty(key)) {
        if (resources[key].Type === 'AWS::Cognito::UserPool') {
          await this.addUserPoolIdToOutput('UserPoolId' + key, key);
        }
      }
    }
  }

  private async addUserPoolIdToOutput(name: string, value: string) {
    const outputs = this.serverless.service.provider.compiledCloudFormationTemplate.Outputs;
    // @ts-ignore
    outputs[name] = {
      Value: {
        Ref: value,
      },
    };
  }

  /**
   * User Pool Domain CRUD
   */

  private async createUserPoolDomain(userPoolId: string, domain: string, certificateArn?: string) {
    const params: CognitoIdentityServiceProvider.Types.CreateUserPoolDomainRequest = {
      CustomDomainConfig: (certificateArn) ? {
        CertificateArn: certificateArn,
      } : undefined,
      Domain: domain,
      UserPoolId: userPoolId,
    };
    await this.provider.request(
      'CognitoIdentityServiceProvider',
      'createUserPoolDomain',
      params,
      this.stage,
      this.region,
    );
  }

  private async deleteUserPoolDomain(userPoolId: string, domain: string) {
    const params: CognitoIdentityServiceProvider.Types.DeleteUserPoolDomainRequest = {
      Domain: domain,
      UserPoolId: userPoolId,
    };
    await this.provider.request(
      'CognitoIdentityServiceProvider',
      'deleteUserPoolDomain',
      params,
      this.stage,
      this.region,
    );
  }

  private async updateUserPoolDomain(userPoolId: string, domain: string, certificate: string) {
    const params: CognitoIdentityServiceProvider.Types.UpdateUserPoolDomainRequest = {
      CustomDomainConfig: {
        CertificateArn: certificate,
      },
      Domain: domain,
      UserPoolId: userPoolId,
    };
    await this.provider.request(
      'CognitoIdentityServiceProvider',
      'updateUserPoolDomain',
      params,
      this.stage,
      this.region,
    );
  }

  private async describeUserPoolDomain(domain: string): Promise<CognitoIdentityServiceProvider.DomainDescriptionType
    | undefined> {
    const params: CognitoIdentityServiceProvider.Types.DescribeUserPoolDomainRequest = {
      Domain: domain,
    };
    const result: CognitoIdentityServiceProvider.Types.DescribeUserPoolDomainResponse = await this.provider.request(
      'CognitoIdentityServiceProvider',
      'describeUserPoolDomain',
      params,
      this.stage,
      this.region,
    );
    return result.DomainDescription;
  }
}
