export function normalizeExplorationAffinityText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function explorationTaskMatchesProduct(task, product, normalize = normalizeExplorationAffinityText) {
  const productName = normalize(product?.canonicalName);
  const taskText = normalize([task?.query, task?.topic, task?.series, task?.brand].filter(Boolean).join(" "));
  if (productName && taskText.includes(productName)) return true;

  const productBrand = normalize(product?.brand);
  const taskBrand = normalize(task?.brand);
  if (productBrand.length >= 4 && taskBrand === productBrand) return true;

  const productSeries = normalize(product?.series);
  const taskSeries = normalize(task?.series);
  return productSeries.length >= 4 && taskSeries === productSeries;
}

export function selectProductExplorationTasks(tasks, product, limit = 4) {
  return (tasks ?? []).filter((task) => explorationTaskMatchesProduct(task, product)).slice(0, limit);
}
