/** Structured errors for BridgedAI actions (no secret material in messages). */

export class UserError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}

export class ConfigurationError extends UserError {
  constructor(message: string) {
    super('CONFIGURATION', message);
    this.name = 'ConfigurationError';
  }
}

export class ProductionIntegrationError extends UserError {
  constructor(message: string) {
    super('PRODUCTION_INTEGRATION', message);
    this.name = 'ProductionIntegrationError';
  }
}

export class MockModeRequiredError extends UserError {
  constructor(message: string) {
    super('MOCK_MODE_REQUIRED', message);
    this.name = 'MockModeRequiredError';
  }
}
