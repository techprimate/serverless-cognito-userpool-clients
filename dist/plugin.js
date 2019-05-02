"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AWS = require("aws-sdk");
const chalk_1 = require("chalk");
class CognitoClientsPlugin {
    constructor(serverless) {
        this.serverless = serverless;
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
    async beforeRemove() {
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
    async afterDeploy() {
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
    async updateClient(config) {
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
        const result = await this.provider.request('CognitoIdentityServiceProvider', 'updateUserPoolClient', params, this.stage, this.region);
        if (result.error) {
            return this.pluginLog(result.error);
        }
        this.pluginLog('Updated Cognito User Pool Client: ' + config.clientId);
    }
    async updateDomain(config) {
        const userPool = await this.describeUserPool(config.userPoolId);
        if (!userPool.CustomDomain && !config.customDomain) { // no domain created nor given
            return;
        }
        if (!userPool.Id) {
            throw new Error('User Pool has no id: ' + userPool);
        }
        if (userPool.CustomDomain && !config.customDomain) { // Delete remote
            await this.deleteUserPoolDomain(userPool.Id, userPool.CustomDomain);
        }
        else if (config.customDomain && !userPool.CustomDomain) { // Create remote
            await this.createUserPoolDomain(config.userPoolId, config.customDomain.name, config.customDomain.certificateArn);
        }
        else { // Update remote
            if (!config.customDomain || !userPool.CustomDomain) {
                return;
            }
            if (userPool.CustomDomain !== config.customDomain.name) {
                await this.deleteUserPoolDomain(userPool.Id, userPool.CustomDomain);
                await this.createUserPoolDomain(config.userPoolId, config.customDomain.name, config.customDomain.certificateArn);
            }
            else {
                const userPoolDomain = await this.describeUserPoolDomain(config.customDomain.name);
                if (userPoolDomain &&
                    userPoolDomain.CustomDomainConfig &&
                    userPoolDomain.CustomDomainConfig.CertificateArn !== config.customDomain.certificateArn) {
                    await this.updateUserPoolDomain(config.userPoolId, config.customDomain.name, config.customDomain.certificateArn);
                }
            }
        }
    }
    async describeUserPool(id) {
        const params = {
            UserPoolId: id,
        };
        const result = await this.provider.request('CognitoIdentityServiceProvider', 'describeUserPool', params, this.stage, this.region);
        return result.UserPool;
    }
    pluginLog(msg) {
        this.serverless.cli.log(`${chalk_1.default.yellow('Plugin [cognito-userpool-clients]')}: ${msg}`);
    }
    /**
     * Outputs
     */
    async addOutputs() {
        const resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
        for (const key in resources) {
            if (resources.hasOwnProperty(key)) {
                if (resources[key].Type === 'AWS::Cognito::UserPool') {
                    await this.addUserPoolIdToOutput('UserPoolId' + key, key);
                }
            }
        }
    }
    async addUserPoolIdToOutput(name, value) {
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
    async createUserPoolDomain(userPoolId, domain, certificateArn) {
        const params = {
            CustomDomainConfig: (certificateArn) ? {
                CertificateArn: certificateArn,
            } : undefined,
            Domain: domain,
            UserPoolId: userPoolId,
        };
        await this.provider.request('CognitoIdentityServiceProvider', 'createUserPoolDomain', params, this.stage, this.region);
    }
    async deleteUserPoolDomain(userPoolId, domain) {
        const params = {
            Domain: domain,
            UserPoolId: userPoolId,
        };
        await this.provider.request('CognitoIdentityServiceProvider', 'deleteUserPoolDomain', params, this.stage, this.region);
    }
    async updateUserPoolDomain(userPoolId, domain, certificate) {
        const params = {
            CustomDomainConfig: {
                CertificateArn: certificate,
            },
            Domain: domain,
            UserPoolId: userPoolId,
        };
        await this.provider.request('CognitoIdentityServiceProvider', 'updateUserPoolDomain', params, this.stage, this.region);
    }
    async describeUserPoolDomain(domain) {
        const params = {
            Domain: domain,
        };
        const result = await this.provider.request('CognitoIdentityServiceProvider', 'describeUserPoolDomain', params, this.stage, this.region);
        return result.DomainDescription;
    }
}
exports.CognitoClientsPlugin = CognitoClientsPlugin;
//# sourceMappingURL=plugin.js.map