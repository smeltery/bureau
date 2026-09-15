export class BackendNotConfiguredError extends Error {
  command?: string;

  constructor(message: string, command?: string) {
    super(message);
    this.name = "BackendNotConfiguredError";
    this.command = command;
  }
}

export class ProviderCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCapacityError";
  }
}
