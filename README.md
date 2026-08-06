# 全年水果雷达

一个本地运行的网页工具，自动遍历农甲水果分类，读取每个商品详情页，并筛选“产品周期”为“全年”的商品。

## 启动

双击 `start.bat`，浏览器会自动打开：

http://127.0.0.1:3789

也可以在命令行中运行：

```powershell
npm start
```

## 免费公开网站

项目已经支持 GitHub Pages：

- `.github/workflows/pages.yml` 会把网页发布到免费的 `github.io` 地址。
- `.github/workflows/scan.yml` 每天北京时间 09:23 自动扫描并提交最新数据。
- 在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中，将 Source 设为 **GitHub Actions**。
- 也可以在仓库的 **Actions → Refresh fruit data → Run workflow** 手动更新。

## 功能

- 自动遍历水果分类全部分页
- 检查每个商品详情页的产品周期
- 保存结果到本机 `data/products.json`
- 按名称、规格、产地搜索
- 按产地筛选
- CSV 导出
- 标记本次扫描中新出现的全年商品

## 注意

- 扫描期间需要联网。
- 请不要连续频繁点击扫描，以免给目标网站造成压力。
- 网站页面结构如有改版，解析规则可能需要相应调整。
- 工具只整理公开页面信息，不会登录、下单或修改网站内容。
