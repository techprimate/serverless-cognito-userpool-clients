import { ISLSCognitoClient } from 'serverless-cognito-userpool-clients/src/ISLSCognitoClient';

declare namespace Serverless {
  interface Options {
    stage: string | null;
    region: string | null;
    noDeploy?: boolean;
  }

  namespace Provider {
    class Aws {

      public request: (service: string, method: string, data: {}, stage: string, region: string) => Promise<any>;

      constructor(serverless: Serverless, options: Serverless.Options)

      public getStage(): string;

      public getRegion(): string;
    }
  }
}

declare interface Serverless {

  cli: {
    log(message: string): null,
  };

  config: {
    cognitoClients: ISLSCognitoClient[],
  };

  service: {

    provider: {
      name: string,
      compiledCloudFormationTemplate: {
        Resources: Array<{
          Type: string,
        }>,
        Outputs: AWS.CloudFormation.Output[],
      },
    }

    custom: {
      warningThreshold: number,
    }
    resources: {
      Resources: Array<{
        Type: string,
        Properties: {
          UserPoolName: string,
        },
      }>,
    }
    getServiceName(): string
    getAllFunctions(): string[],
  };

  init(): Promise<any>;

  run(): Promise<any>;

  setProvider(name: string, provider: Serverless.Provider.Aws): null;

  getProvider(name: string): Serverless.Provider.Aws;

  getVersion(): string;
}
