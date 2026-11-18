export class LiveElsewhere extends Error {
  constructor(readonly path: string, number: number) {
    super(`#${number} went live in a new VS Code window, at ${path}.`);
    this.name = "LiveElsewhere";
  }
}
