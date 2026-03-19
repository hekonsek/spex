interface PersistOptions {
  symbol?: string;
  text?: string;
}

export interface SpinnerHistoryLike {
  text: string;
  start(text?: string): void;
  stopAndPersist(options?: PersistOptions): void;
}

export interface ReplaceSpinnerTextOptions {
  persistPrevious?: boolean;
}

function persistText(text: string): PersistOptions {
  return {
    symbol: "✔",
    text,
  };
}

export function replaceSpinnerText(
  spinner: SpinnerHistoryLike,
  nextText: string,
  options: ReplaceSpinnerTextOptions = {},
): void {
  if (spinner.text === nextText) {
    return;
  }

  if (options.persistPrevious && spinner.text) {
    spinner.stopAndPersist(persistText(spinner.text));
    spinner.start(nextText);
    return;
  }

  spinner.text = nextText;
}

export function persistSpinnerText(spinner: SpinnerHistoryLike, text = spinner.text): void {
  if (!text) {
    return;
  }

  spinner.stopAndPersist(persistText(text));
}
