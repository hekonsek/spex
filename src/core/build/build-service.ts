export interface BuildServiceListener {
  onBuildStarted(message: string): void;
}

export class BuildService {
  constructor(private readonly listener: BuildServiceListener) {}

  run(): string {
    const message = "Building your spex";
    this.listener.onBuildStarted(message);
    return message;
  }
}
