export class CognitoClientsPlugin {
    public hooks: {};
    public provider: Serverless.Provider.Aws;
    public commands: {};

    constructor(private serverless: Serverless) {
        this.hooks = {
            'after:deploy:deploy': this.process.bind(this),
            'cognito_clients:deploy:deploy': this.process.bind(this),
        };
        this.provider = this.serverless.getProvider('aws');
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
                this.serverless.getProvider('aws').getStage(),
                this.serverless.getProvider('aws').getRegion(),
            );
            if (result.error) {
                this.serverless.cli.log('Updated Cognito User Pool Client: ' + config.clientId);
            }
            this.serverless.cli.log('Updated Cognito User Pool Client: ' + config.clientId);
        }
    }
}
