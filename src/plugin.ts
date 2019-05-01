import { CloudFormation, CognitoIdentityServiceProvider } from 'aws-sdk';
import { Serverless } from '../typings/serverless';
import { ISLSCognitoClient } from './ISLSCognitoClient';

export class CognitoClientsPlugin {
  public hooks: {};
  public provider: Serverless.Provider.Aws;
  public commands: {};

  private readonly servicename: string;
  private readonly stage: string;
  private readonly region: string;
  private readonly stackname: string;

  constructor(private serverless: Serverless) {
    this.serverless = serverless;
    this.servicename = this.serverless.service.getServiceName();

    this.provider = this.serverless.getProvider('aws');
    this.stage = this.provider.getStage();
    this.region = this.provider.getRegion();
    this.stackname = this.servicename + '-' + this.stage;

    this.hooks = {
      'after:aws:package:finalize:mergeCustomProviderResources': this.add_outputs.bind(this),
      'after:deploy:deploy': this.process_deploy.bind(this),
      'cognito_clients:deploy:deploy': this.process_deploy.bind(this),

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

  public async get_sls_userpool_names() {
    if (this.serverless.service.resources === null || this.serverless.service.resources.Resources === null) {
      return null;
    }
    const names = [];
    const that = this;
    let keys = [];
    try {
      keys = Object.keys(this.serverless.service.resources.Resources);
    } catch (error) {
      this.plugin_log(error.stack);
    }
    keys.forEach((value) => {
      const item = that.serverless.service.resources.Resources[value];
      if (item.Type === 'AWS::Cognito::UserPool') {
        names.push(item.Properties.UserPoolName);
      }
    });
    return names;
  }

  public async get_aws_cognito_userpools() {
    const userpools = [];
    const params = {
      MaxResults: 1, /* required */
      /* NextToken: 'STRING_VALUE' */
    };
    let hasNext = true;
    while (hasNext) {
      await this.cognitoIdp.listUserPools(params).promise().then((data) => {
        if (data.UserPools.length != 0) {
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
        this.plugin_log(util.format('Error: %s, \'%s\'', error.code, error.message));
      });
    }
    if (userpools.length === 0) {
      return null;
    } else {
      return userpools;
    }
  }

  public async delete_userpool_domain(userpoolid, domainname) {
    const that = this;
    this.plugin_log('Deleting user pool domain...');
    this.plugin_log(`userpoolid: [${userpoolid}], domainname: [${domainname}]`);
    try {
      const params = {
        Domain: domainname,
        UserPoolId: userpoolid,
      };
      await this.cognitoIdp.deleteUserPoolDomain(params).promise().then((data) => {
        that.plugin_log('domain deleted');
      }).catch((error) => {
        that.plugin_log(util.format('Error: %s, \'%s\'', error.code, error.message));
      });
      this.plugin_log('done.');
    } catch (error) {
      this.plugin_log(error.stack);
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

    this.plugin_log('process_remove started.');
    // get userpool names from serverless.yml in a array
    const names = await this.get_sls_userpool_names();
    if (!names) {
      this.plugin_log('no userpools defined in serverless.yml to be to removed.');
      return;
    }
    // get userpool strutures from aws
    const userpools = await this.get_aws_cognito_userpools();
    if (!userpools) {
      this.plugin_log('no userpools on aws to be removed.');
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
      this.plugin_log('no userpools to remove.');
    }

    for (const userpoolindex in userpools2process) {
      if (userpools2process[userpoolindex]) {
        const userpool = userpools2process[userpoolindex];
        await this.delete_userpool_domain(userpool.Id, userpool.Name);
      }
    }
    this.plugin_log('process_remove finished.');
  }

  private async process_deploy() {
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

    this.plugin_log('process_deploy started.');
    try {
      const userpoolids = await this.get_deployed_userpool_id();
      userpoolids.forEach((userpoolid) => {
        const resource = that.serverless.service.resources.Resources[userpoolid.name.substring(10)];
        const domain = resource.Properties.UserPoolName;
        userpoolid.domain = domain;
      });
      for (const index in userpoolids) {
        await that.create_userpool_domain(userpoolids[index].id, userpoolids[index].domain);
      }
    } catch (error) {
      this.plugin_log(error.stack);
    }
    this.plugin_log('process_deploy finished.');
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
      return this.plugin_log(result.error);
    }
    this.plugin_log('Updated Cognito User Pool Client: ' + config.clientId);
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
      if (resources[key].Type === 'AWS::Cognito::UserPool') {
        await this.add_poolid_outputs('UserPoolId' + key, key);
      }
    }
  }

  private async add_poolid_outputs(name: string, value: string) {
    const outputs = this.serverless.service.provider.compiledCloudFormationTemplate.Outputs;
    outputs[name] = {
      Value: {
        Ref: value,
      },
    };
  }

  private async get_deployed_userpool_id(): Promise<Array<{ id: string, name: string, domain?: string }>> {
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

  private plugin_log(msg: any) {
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
      params);
    return result.Stacks[0];
  }

  /**
   * User Pool Domain CRUD
   */

  private async createUserPoolDomain(userPoolId: string, domain: string, certificateArn: string) {
    const params: CognitoIdentityServiceProvider.Types.CreateUserPoolDomainRequest = {
      CustomDomainConfig: {
        CertificateArn: certificateArn,
      },
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
