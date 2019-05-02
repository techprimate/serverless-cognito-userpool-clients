import { Serverless } from '../typings/serverless';
export declare class CognitoClientsPlugin {
    private serverless;
    hooks: {};
    provider: Serverless.Provider.Aws;
    commands: {};
    private readonly stage;
    private readonly region;
    constructor(serverless: Serverless);
    private beforeRemove;
    private afterDeploy;
    private updateClient;
    private updateDomain;
    private describeUserPool;
    private pluginLog;
    /**
     * Outputs
     */
    private addOutputs;
    private addUserPoolIdToOutput;
    /**
     * User Pool Domain CRUD
     */
    private createUserPoolDomain;
    private deleteUserPoolDomain;
    private updateUserPoolDomain;
    private describeUserPoolDomain;
}
//# sourceMappingURL=plugin.d.ts.map