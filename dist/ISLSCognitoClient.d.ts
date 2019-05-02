export interface ISLSCognitoClient {
    userPoolId: string;
    clientId: string;
    callbackUrls?: string[];
    logoutUrls?: string[];
    allowedOAuthFlows?: string[];
    allowedOAuthScopes?: string[];
    allowedOAuthFlowsUserPoolClient?: boolean;
    supportedIdentityProviders?: string[];
    customDomain?: {
        name: string;
        certificateArn: string;
    };
}
//# sourceMappingURL=ISLSCognitoClient.d.ts.map