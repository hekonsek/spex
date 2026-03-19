function persistText(text) {
    return {
        symbol: "✔",
        text,
    };
}
export function replaceSpinnerText(spinner, nextText, options = {}) {
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
export function persistSpinnerText(spinner, text = spinner.text) {
    if (!text) {
        return;
    }
    spinner.stopAndPersist(persistText(text));
}
