/** An error the user can understand, with what to do next. Thrown by every repository and workflow rule. */
export class RepositoryError extends Error {
  constructor(
    message: string,
    /** What the user should do next. */
    readonly nextStep: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
