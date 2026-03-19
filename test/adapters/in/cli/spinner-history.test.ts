import assert from "node:assert/strict";
import test from "node:test";
import {
  persistSpinnerText,
  replaceSpinnerText,
  type SpinnerHistoryLike,
} from "../../../../src/adapters/in/cli/spinner-history.js";

class FakeSpinner implements SpinnerHistoryLike {
  text: string;
  readonly events: Array<{ type: string; text: string | undefined; symbol: string | undefined }> = [];

  constructor(text: string) {
    this.text = text;
  }

  start(text?: string): void {
    if (text !== undefined) {
      this.text = text;
    }

    this.events.push({ type: "start", text, symbol: undefined });
  }

  stopAndPersist(options?: { symbol?: string; text?: string }): void {
    this.events.push({
      type: "persist",
      symbol: options?.symbol,
      text: options?.text,
    });
  }
}

test("replaceSpinnerText persists previous spinner message before starting the next one", () => {
  const spinner = new FakeSpinner("Building catalog index");

  replaceSpinnerText(spinner, "Reading spex-catalog.yml", { persistPrevious: true });

  assert.equal(spinner.text, "Reading spex-catalog.yml");
  assert.deepEqual(spinner.events, [
    { type: "persist", symbol: "✔", text: "Building catalog index" },
    { type: "start", text: "Reading spex-catalog.yml", symbol: undefined },
  ]);
});

test("replaceSpinnerText updates spinner text in place when history is disabled", () => {
  const spinner = new FakeSpinner("Building catalog index");

  replaceSpinnerText(spinner, "Reading spex-catalog.yml");

  assert.equal(spinner.text, "Reading spex-catalog.yml");
  assert.deepEqual(spinner.events, []);
});

test("persistSpinnerText persists the current spinner message", () => {
  const spinner = new FakeSpinner("Writing spex-catalog-index.yml");

  persistSpinnerText(spinner);

  assert.deepEqual(spinner.events, [
    { type: "persist", symbol: "✔", text: "Writing spex-catalog-index.yml" },
  ]);
});

test("persistSpinnerText can persist a custom message", () => {
  const spinner = new FakeSpinner("Writing spex-catalog-index.yml");

  persistSpinnerText(spinner, "OK catalog index built (4 package(s))");

  assert.deepEqual(spinner.events, [
    { type: "persist", symbol: "✔", text: "OK catalog index built (4 package(s))" },
  ]);
});
