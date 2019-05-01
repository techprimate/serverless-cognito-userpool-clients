declare namespace Serverless {
  interface Options {
    stage: string | null;
    region: string | null;
    noDeploy?: boolean;
  }

  namespace Provider {
    class Aws {
      constructor(serverless: Serverless, options: Serverless.Options)
    }
  }
}

declare interface Serverless {

  cli: {
    log(message: string): null,
  };

  config: {
    servicePath: string,
  };

  service: {

    provider: {
      name: string,
    }

    custom: {
      warningThreshold: number,
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
