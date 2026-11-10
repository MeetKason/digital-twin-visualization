/** 产品清单集中描述可用连接器、依赖和 UI 状态，避免散落硬编码。 */
export interface IngestionProduct {
  id: string;
  label: string;
  available: boolean;
  dependencies: string[];
}

export const defaultIngestionProducts: IngestionProduct[] = [
  {
    id: "surface-hourly",
    label: "地面小时观测",
    available: true,
    dependencies: [],
  },
  {
    id: "radar-grid",
    label: "雷达格点",
    available: true,
    dependencies: [],
  },
  {
    id: "satellite-cloud",
    label: "卫星云图",
    available: true,
    dependencies: [],
  },
  { id: "wind-field", label: "风场", available: true, dependencies: [] },
  { id: "humidity-field", label: "相对湿度", available: true, dependencies: [] },
  { id: "grid-analysis", label: "综合网格", available: true, dependencies: [] },
  { id: "forecast-hourly", label: "逐小时预报", available: true, dependencies: [] },
  { id: "warning-range", label: "预警范围模拟", available: true, dependencies: [] },
  { id: "environment-simulation", label: "自然环境模拟", available: true, dependencies: [] },
];

export function validateProductRegistry(products: IngestionProduct[]) {
  const ids = new Set<string>();
  for (const product of products) {
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(product.id) || ids.has(product.id))
      throw new Error("采集产品 ID 无效或重复");
    ids.add(product.id);
  }
  for (const product of products) {
    if (product.dependencies.some((dependency) => !ids.has(dependency)))
      throw new Error(`产品 ${product.id} 依赖了未知产品`);
    if (product.available && product.dependencies.some((dependency) => !products.find((item) => item.id === dependency)?.available))
      throw new Error(`可用产品 ${product.id} 不能依赖未接入产品`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("采集产品依赖不能形成循环");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of products.find((item) => item.id === id)!.dependencies)
      visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const product of products) visit(product.id);
  return products;
}
