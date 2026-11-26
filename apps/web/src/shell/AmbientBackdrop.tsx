/**
 * 全站环境氛围背景层：
 * - cinema（液态光场）：双色 OKLCH 漫反射光球，随当前浏览的照片平滑变色呼吸；
 * - monograph（美术馆画册）：纯静态 SVG 极低频静纸微粒（由 skins.css 伪元素绘制），零持续 GPU 开销。
 */
export function AmbientBackdrop() {
  return (
    <div className="lv-ambient-stage" aria-hidden="true">
      <div className="lv-ambient-orb lv-ambient-orb-1" />
      <div className="lv-ambient-orb lv-ambient-orb-2" />
    </div>
  );
}
