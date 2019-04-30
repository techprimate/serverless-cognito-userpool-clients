declare namespace Serverless {
  interface Options {
    stage: string | null
    region: string | null
    noDeploy?: boolean
  }

  namespace Provider {
    class Aws {
      constructor(serverless: Serverless, options: Serverless.Options)

      getProviderName: () => string;
      getRegion: () => string;
      getServerlessDeploymentBucketName: () => string;
      getStage: () => string;

      request: (service: string, method: string, data: {}, stage: string, region: string) => Promise<any>;
    }
  }
}

declare interface Serverless {
  init(): Promise<any>

  run(): Promise<any>

  getProvider(name: string): Serverless.Provider.Aws

  cli: {
    log(message: string): null
  }

  service: {
    custom: {
      cognitoClients: Array<{
        userPoolId: string,
        clientId: string,
        callbackUrls?: string[],
        logoutUrls?: string[],
        allowedOAuthFlows?: string[],
        allowedOAuthScopes?: string[],
        allowedOAuthFlowsUserPoolClient?: boolean
      }>,
    }
  }
}
