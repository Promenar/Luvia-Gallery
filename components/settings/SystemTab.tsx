/** 媒体统计数值格式化：非精确统计（受限账号）显示占位符，避免误导为真实总数。 */
export const formatMediaStatValue = (value: number | undefined, exact: boolean | undefined): string =>
  exact === false ? '—' : (value || 0).toLocaleString();
