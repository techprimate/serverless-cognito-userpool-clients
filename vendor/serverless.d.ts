declare namespace Serverless {
  interface Options {
    stage: string | null;
    region: string | null;
    noDeploy?: boolean;
  }

  namespace Provider {
    class Aws {

      public getRegion: () => string;
      public getStage: () => string;

      public request: (service: string, method: string, data: {}, stage: string, region: string) => Promise<any>;
      constructor(serverless: Serverless, options: Serverless.Options)
    }
  }
}

declare interface Serverless {

  cli: {
    log(message: string): null,
  };

  service: {
    custom: {
      cognitoClients: Array<{
        userPoolId: string,
        clientId: string,
        callbackUrls?: string[],
        logoutUrls?: string[],
        allowedOAuthFlows?: string[],
        allowedOAuthScopes?: string[],
        allowedOAuthFlowsUserPoolClient?: boolean,
        supportedIdentityProviders?: string[],
      }>,
    },
  };
  init(): Promise<any>;

  run(): Promise<any>;

  getProvider(name: string): Serverless.Provider.Aws;
}
