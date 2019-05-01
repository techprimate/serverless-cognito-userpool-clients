import { CloudFormation, CognitoIdentityServiceProvider } from 'aws-sdk';
import chalk from 'chalk';
import { Serverless } from '../typings/serverless';
import { ISLSCognitoClient } from './ISLSCognitoClient';
import AWS = require('aws-sdk');

export class CognitoClientsPlugin {
  public hooks: {};
  public provider: Serverless.Provider.Aws;
  public commands: {};

  private readonly servicename: string;
  private readonly stage: string;
  private readonly region: string;
  private readonly stackname: string;
  private readonly cognitoIdp: AWS.CognitoIdentityServiceProvider;

  constructor(private serverless: Serverless) {
    this.serverless = serverless;
    this.servicename = this.serverless.service.getServiceName();

    this.provider = this.serverless.getProvider('aws');
    this.stage = this.provider.getStage();
    this.region = this.provider.getRegion();
    this.stackname = this.servicename + '-' + this.stage;

    AWS.config.update({
      region: this.region,
    });

    this.cognitoIdp = new AWS.CognitoIdentityServiceProvider({apiVersion: '2016-04-18'});

    this.hooks = {
      'after:aws:package:finalize:mergeCustomProviderResources': this.add_outputs.bind(this),
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

  public async getSLSUserPoolNames() {
    if (this.serverless.service.resources === null || this.serverless.service.resources.Resources === null) {
      return null;
    }
    const names = [];
    const that = this;
    let keys = [];
    try {
      keys = Object.keys(this.serverless.service.resources.Resources);
    } catch (error) {
      this.pluginLog(error.stack);
    }
    keys.forEach((value) => {
      const item = that.serverless.service.resources.Resources[value];
      if (item.Type === 'AWS::Cognito::UserPool') {
        names.push(item.Properties.UserPoolName);
      }
    });
    return names;
  }

  public async getAWSCognitoUserPools() {
    const userpools = [];
    const params: {
      MaxResults: number,
      NextToken?: string,
    } = {
      MaxResults: 1, /* required */
    };
    let hasNext = true;
    while (hasNext) {
      await this.cognitoIdp.listUserPools(params).promise().then((data) => {
        if (data.UserPools.length !== 0) {
          Array.prototype.push.apply(userpools, data.UserPools);
          userpools.concat(data.UserPools);
          if (data.NextToken) {
            params.NextToken = data.NextToken;
          } else {
            hasNext = false;
          }
        } else {
          hasNext = false;
        }
      }).catch((error) => {
        this.pluginLog(`Error: ${error.code}, \'${error.message}\'`);
      });
    }
    if (userpools.length === 0) {
      return null;
    } else {
      return userpools;
    }
  }

  private async beforeRemove() {
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

    this.pluginLog('process_remove started.');
    // get userpool names from serverless.yml in a array
    const names = await this.getSLSUserPoolNames();
    if (!names) {
      this.pluginLog('no userpools defined in serverless.yml to be to removed.');
      return;
    }
    // get userpool strutures from aws
    const userpools = await this.getAWSCognitoUserPools();
    if (!userpools) {
      this.pluginLog('no userpools on aws to be removed.');
      return;
    }
    // process only the aws userpools that are defined on serverless.yml
    const userpools2process = [];
    userpools.forEach((userpool) => {
      if (names.includes(userpool.Name)) {
        userpools2process.push(userpool);
      }
    });

    if (userpools2process.length === 0) {
      this.pluginLog('no userpools to remove.');
    }

    for (const userpoolindex in userpools2process) {
      if (userpools2process[userpoolindex]) {
        const userpool = userpools2process[userpoolindex];
        await this.deleteUserPoolDomain(userpool.Id, userpool.Name);
      }
    }
    this.pluginLog('process_remove finished.');
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

    this.pluginLog('afterDeploy started.');
    const userPoolIds = await this.getDeployedUserPoolIds();
    userPoolIds.forEach((userPool) => {
      const resource = this.serverless.service.resources.Resources[userPool.name.substring(10)];
      const domain = resource.Properties.UserPoolName;
      userPool.domain = domain;
    });
    for (const userPool of userPoolIds) {
      await this.createUserPoolDomain(userPool.id, userPool.domain);
    }
    this.pluginLog('afterDeploy finished.');
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
    if (userPool.CustomDomain && !config.customDomain) { // Delete remote
      await this.deleteUserPoolDomain(userPool.Id, userPool.CustomDomain);
    } else if (config.customDomain && !userPool.CustomDomain) { // Create remote
      await this.createUserPoolDomain(config.userPoolId, config.customDomain.name, config.customDomain.certificateArn);
    } else { // Update remote
      if (userPool.CustomDomain !== config.customDomain.name) {
        await this.deleteUserPoolDomain(userPool.Id, userPool.CustomDomain);
        await this.createUserPoolDomain(config.userPoolId,
          config.customDomain.name,
          config.customDomain.certificateArn);
      } else {
        const userPoolDomain = await this.describeUserPoolDomain(config.customDomain.name);
        if (userPoolDomain.CustomDomainConfig
          && userPoolDomain.CustomDomainConfig.CertificateArn !== config.customDomain.certificateArn) {
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

  private async add_outputs() {
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
    outputs[name] = {
      Value: {
        Ref: value,
      },
    };
  }

  private async getDeployedUserPoolIds(): Promise<Array<{ id: string, name: string, domain?: string }>> {
    const userPoolIds = [];
    const result = await this.describeCloudFormationStack();
    const results = result.Outputs;
    results.forEach((item) => {
      if (item.OutputKey.startsWith('UserPoolId')) {
        userPoolIds.push({id: item.OutputValue, name: item.OutputKey});
      }
    });
    return userPoolIds;
  }

  private pluginLog(msg: any) {
    this.serverless.cli.log(`${chalk.yellow('Plugin [cognito-userpool-clients]')}: ${msg}`);
  }

  /**
   * Cloud Formation Stacks CRUD
   */

  private async describeCloudFormationStack(): Promise<CloudFormation.Stack> {
    const params: CloudFormation.Types.DescribeStacksInput = {
      StackName: this.stackname,
    };
    const result: CloudFormation.Types.DescribeStacksOutput = await this.provider.request(
      'CloudFormation',
      'describeStacks',
      params,
      this.stage,
      this.region);
    return result.Stacks[0];
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

  private async describeUserPoolDomain(domain: string): Promise<CognitoIdentityServiceProvider.DomainDescriptionType> {
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
