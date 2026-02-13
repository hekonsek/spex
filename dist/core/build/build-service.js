export class BuildService {
    listener;
    constructor(listener) {
        this.listener = listener;
    }
    run() {
        const message = "Building your spex";
        this.listener.onBuildStarted(message);
        return message;
    }
}
