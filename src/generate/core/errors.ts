/**
 * Error subclass tagged with the CLI exit code reserved for generation
 * failures. SPEC §3.1 / §3.6: ConfigError=2, DeployTargetError=3, PackError=4,
 * GenerateError=5.
 */
export class GenerateError extends Error {
  readonly exitCode = 5;
  constructor(message: string) {
    super(message);
    this.name = "GenerateError";
  }
}
