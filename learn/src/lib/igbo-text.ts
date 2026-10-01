export function normalizeIgboText(value: string) {
  return value.normalize("NFC");
}

export function foldIgboText(value: string) {
  return normalizeIgboText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en");
}
