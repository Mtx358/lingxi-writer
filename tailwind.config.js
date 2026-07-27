/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f5f2',
          100: '#e8e4dc',
          200: '#d4cfc4',
          300: '#c4beb0',
          400: '#9b9588',
          // 500/600 互换：上一轮将 ink-600 提亮到 #948e7e 后，
          // 反而比 ink-500 (#8b8577) 更亮，导致梯度方向倒置（500 应亮于 600）。
          // 互换后：ink-500=#948e7e (L≈0.272, 对比度≈5.27:1)，
          //         ink-600=#8b8577 (L≈0.236, 对比度≈4.69:1)。
          // 两者均 ≥ 4.5:1（WCAG AA），ΔL≈0.036（13% 相对差），梯度方向正确。
          500: '#948e7e',
          600: '#8b8577',
          700: '#4a4640',
          800: '#2a2825',
          900: '#1a1a1f',
          950: '#111114',
        },
        amber: {
          50: '#fdf8f3',
          100: '#f8ebdc',
          200: '#f0d4b8',
          300: '#e5b78a',
          400: '#d4a574',
          500: '#c48c52',
          600: '#a8723e',
          700: '#8b5a33',
          800: '#704a2e',
          900: '#5c3e29',
        },
        slate: {
          50: '#f5f7fa',
          100: '#e4e8ef',
          200: '#cdd5e0',
          300: '#a7b4c6',
          400: '#7a8ca6',
          500: '#5c6f8a',
          600: '#485870',
          700: '#3a4759',
          800: '#313b4a',
          900: '#2c343f',
        },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Source Han Serif"', 'Georgia', 'serif'],
        sans: ['"Noto Sans SC"', '"PingFang SC"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1.5' }],
        'sm': ['0.875rem', { lineHeight: '1.6' }],
        'base': ['1rem', { lineHeight: '1.75' }],
        'lg': ['1.125rem', { lineHeight: '1.8' }],
        'xl': ['1.25rem', { lineHeight: '1.8' }],
        '2xl': ['1.5rem', { lineHeight: '1.5' }],
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0, 0, 0, 0.12)',
        'medium': '0 4px 16px rgba(0, 0, 0, 0.18)',
        'large': '0 8px 32px rgba(0, 0, 0, 0.24)',
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-left': 'slide-left 0.3s ease-out',
        'slide-right': 'slide-right 0.3s ease-out',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-left': {
          '0%': { opacity: '0', transform: 'translateX(10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-right': {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};
