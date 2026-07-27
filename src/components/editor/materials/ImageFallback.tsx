import { useState, useEffect } from 'react';
import { Image } from 'lucide-react';
// 图片 dataURL LRU 缓存与清理函数已抽离到 utils/imageCache，供组件层与 store 层共享，
// 避免 store 反向 import 组件层形成循环依赖。
import { readImageDataUrl } from '@/utils/imageCache';

export function ImageFallback({ src, name }: { src: string; name: string }) {
  const [error, setError] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string>(src);

  // 开发环境下 http(s) 页面无法加载 file:// 资源
  // 通过 electron bridge 读取为 data URL；无 bridge 时降级显示占位图标
  // 命中模块级 LRU 缓存时不会重复读取磁盘
  useEffect(() => {
    let active = true;
    // 切换 src 时必须复位 error 状态并重置 resolvedSrc，否则上一个图片加载失败后
    // 即便新 src 能正常读取，仍会停留在错误占位图标上。
    setError(false);
    setResolvedSrc(src);
    if (src.startsWith('file://')) {
      // window.electronAPI 的完整类型已在 vite-env.d.ts 全局声明，无需重复断言
      if (window.electronAPI?.file?.readDataURL) {
        readImageDataUrl(src.replace('file://', ''))
          .then(dataUrl => { if (active) { setError(false); setResolvedSrc(dataUrl); } })
          .catch(() => { if (active) setError(true); });
      } else if (typeof window !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:')) {
        // 开发环境无 electron bridge，直接标记错误，显示占位图标
        setError(true);
      }
    }
    return () => { active = false; };
  }, [src]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-ink-500 bg-ink-800/50">
        <Image className="w-6 h-6" />
      </div>
    );
  }
  return (
    <img
      src={resolvedSrc}
      alt={name}
      className="w-full h-full object-cover"
      onError={() => setError(true)}
    />
  );
}
