export class CognitoClientsPlugin {
  public hooks: {};
  public provider: Serverless.Provider.Aws;
  public commands: {};

  constructor(private serverless: Serverless, private options: Serverless.Options) {
    this.hooks = {
      'after:deploy:deploy': this.process.bind(this),
      'cognito_clients:deploy:deploy': this.process.bind(this),
    };
    this.provider = this.serverless.getProvider('aws');
    this.commands = {
      cognito_clients: {
        lifecycleEvents: [
          'deploy',
        ],
        commands: {
          deploy: {
            lifecycleEvents: [
              'deploy',
            ],
            usage: "Deploys a domain using the domain name defined in the serverless file",
          },
        },
      }
    };
  }

  private async process() {
    const custom = this.serverless.service.custom;
    if (!custom) {
      return;
    }
    const configs = this.serverless.service.custom.cognitoClients;
    if (!configs || !Array.isArray(configs)) {
      return;
    }

    for (const config of configs) {
      const params = {
        UserPoolId: config.userPoolId,
        ClientId: config.clientId,
        CallbackURLs: config.callbackUrls,
        LogoutURLs: config.logoutUrls,
        AllowedOAuthFlows: config.allowedOAuthFlows,
        AllowedOAuthScopes: config.allowedOAuthScopes,
        AllowedOAuthFlowsUserPoolClient: config.allowedOAuthFlowsUserPoolClient,
      };
      const result = await this.provider.request(
        'CognitoIdentityServiceProvider',
        'updateUserPoolClient',
        params,
        this.serverless.getProvider('aws').getStage(),
        this.serverless.getProvider('aws').getRegion(),
      );
      this.serverless.cli.log("Updated Cognito User Pool Client: " + config.clientId);
    }
  }
}

