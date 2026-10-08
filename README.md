# 轻盈计划

一个中式家常减脂 + 居家运动的体重管理 PWA 网页应用，可在手机浏览器中“添加到桌面”当 App 使用。

- **今日**：热量环、三餐/运动/体重/喝水打卡、今日运动、今日减脂餐建议（一键记入）、饭点和运动提醒横幅
- **记餐**：选分类 → 选食物 → 点分量（一碗/半碗/一盘/二两……），自动换算热量和蛋白质；也可手动输入
- **记录**：体重（斤）、体重趋势图、近14天摄入柱状图、按日期查看饮食历史
- **计划**：一周运动计划、一周减脂餐、个人设置、备份/恢复

数据全部保存在手机浏览器本地（localStorage），可在「计划 → 设置 → 备份与恢复」导出备份码。

## 部署（GitHub Pages）

仓库 Settings → Pages → Build and deployment → Source 选 **Deploy from a branch**，Branch 选 **main** / **(root)**，保存。
几分钟后访问：https://janeysisuer.github.io/qingying/

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面骨架 |
| `styles.css` | 样式（浅色/深色自动切换） |
| `data.js` | 食物库、运动计划、减脂餐计划 |
| `app.js` | 应用逻辑 |
| `manifest.json` | PWA 安装信息 |
| `sw.js` | Service Worker（离线可用） |
| `icons/` | 应用图标（192/512，含 maskable） |

> 更新代码后，请把 `sw.js` 里的 `CACHE` 版本号加 1（如 `qingying-v2`），手机上才会拿到新版本。
