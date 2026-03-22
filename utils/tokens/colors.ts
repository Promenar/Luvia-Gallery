/**
 * 设计令牌 - 颜色系统
 * 统一管理应用中的所有颜色变量
 */

// 主色调 - 使用accent作为主强调色
export const colors = {
  // Accent 色系 (主强调色)
  accent: {
    50: '#0c1b2b',
    100: '#0f2743',
    200: '#12365e',
    300: '#164b7d',
    400: '#1b65a5',
    500: '#2683d3', // 主色
    600: '#45b5ff', // 高亮
    700: '#7cd8c9',
  },

  // 功能色
  functional: {
    success: '#22c55e',
    successLight: '#22c55e20',
    warning: '#eab308',
    warningLight: '#eab30820',
    error: '#ef4444',
    errorLight: '#ef444420',
    info: '#3b82f6',
    infoLight: '#3b82f620',
  },

  // 表面色 (亮色模式)
  surface: {
    light: {
      primary: '#f8fafc',
      secondary: 'rgba(255, 255, 255, 0.85)',
      tertiary: 'rgba(255, 255, 255, 0.6)',
      deep: '#eff4f9',
      glass: 'rgba(255, 255, 255, 0.65)',
    },
    dark: {
      primary: '#020617',
      secondary: 'rgba(10, 12, 18, 0.85)',
      tertiary: 'rgba(15, 17, 26, 0.7)',
      deep: '#000000',
      glass: 'rgba(8, 10, 15, 0.6)',
    },
  },

  // 文本色
  text: {
    light: {
      primary: '#0f172a',
      secondary: '#475569',
      tertiary: '#6b7280',
      muted: '#94a3b8',
    },
    dark: {
      primary: '#f8fafc',
      secondary: '#94a3b8',
      tertiary: '#64748b',
      muted: '#475569',
    },
  },

  // 边框色
  border: {
    light: {
      default: 'rgba(15, 23, 42, 0.08)',
      subtle: 'rgba(15, 23, 42, 0.04)',
      glow: 'rgba(255, 255, 255, 0.4)',
    },
    dark: {
      default: 'rgba(255, 255, 255, 0.06)',
      subtle: 'rgba(255, 255, 255, 0.03)',
      glow: 'rgba(56, 189, 248, 0.1)',
    },
  },

  // 遮罩色
  overlay: {
    light: 'rgba(15, 23, 42, 0.1)',
    dark: 'rgba(5, 8, 22, 0.55)',
    strong: 'rgba(5, 8, 22, 0.85)',
  },
} as const;

// CSS变量映射 - 用于index.css
export const cssVariables = `
  :root {
    /* Accent Colors */
    --accent-50: ${colors.accent[50]};
    --accent-100: ${colors.accent[100]};
    --accent-200: ${colors.accent[200]};
    --accent-300: ${colors.accent[300]};
    --accent-400: ${colors.accent[400]};
    --accent-500: ${colors.accent[500]};
    --accent-600: ${colors.accent[600]};
    --accent-700: ${colors.accent[700]};
    --accent-rgb: 38, 131, 211;

    /* Functional Colors */
    --color-success: ${colors.functional.success};
    --color-warning: ${colors.functional.warning};
    --color-error: ${colors.functional.error};
    --color-info: ${colors.functional.info};

    /* Light Mode (default) */
    --surface-primary: ${colors.surface.light.primary};
    --surface-secondary: ${colors.surface.light.secondary};
    --surface-tertiary: ${colors.surface.light.tertiary};
    --surface-deep: ${colors.surface.light.deep};
    --surface-glass: ${colors.surface.light.glass};

    --text-primary: ${colors.text.light.primary};
    --text-secondary: ${colors.text.light.secondary};
    --text-tertiary: ${colors.text.light.tertiary};
    --text-muted: ${colors.text.light.muted};

    --border-default: ${colors.border.light.default};
    --border-subtle: ${colors.border.light.subtle};
    --border-glow: ${colors.border.light.glow};

    --overlay-veil: ${colors.overlay.light};
    --overlay-strong: ${colors.overlay.strong};

    --accent-glow: rgba(38, 131, 211, 0.4);
  }

  .dark {
    --surface-primary: ${colors.surface.dark.primary};
    --surface-secondary: ${colors.surface.dark.secondary};
    --surface-tertiary: ${colors.surface.dark.tertiary};
    --surface-deep: ${colors.surface.dark.deep};
    --surface-glass: ${colors.surface.dark.glass};

    --text-primary: ${colors.text.dark.primary};
    --text-secondary: ${colors.text.dark.secondary};
    --text-tertiary: ${colors.text.dark.tertiary};
    --text-muted: ${colors.text.dark.muted};

    --border-default: ${colors.border.dark.default};
    --border-subtle: ${colors.border.dark.subtle};
    --border-glow: ${colors.border.dark.glow};

    --overlay-veil: ${colors.overlay.dark};
    --overlay-strong: ${colors.overlay.strong};

    --accent-glow: rgba(56, 189, 248, 0.2);
  }
`;

export type ColorScale = typeof colors.accent;
export type ColorSystem = typeof colors;
