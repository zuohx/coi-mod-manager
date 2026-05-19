# COI Mod Manager DOM 结构说明

目标：复刻截图中的 H5 页面。本文档只定义页面骨架、区块层级、主要元素、文案位、状态位，可直接交给 agent 生成同结构页面。

## 页面定位

- 类型：深色后台工具页
- 主题：`dark + violet + teal`
- 布局：单页 Dashboard
- 主体宽度：`100%`
- 内容区左右留白：约 `16px`
- 页面结构：`Header -> Directory Bar -> Stats -> Toolbar -> Notice -> Table`

## DOM 树

```html
<body class="theme-dark">
  <div id="app" class="page mod-manager-page">
    <div class="page-shell">
      <header class="page-header">
        <div class="brand-block">
          <h1 class="page-title">COI Mod Manager</h1>
          <p class="page-subtitle">Captain of Industry · Mod 版本管理与更新</p>
        </div>

        <div class="header-actions">
          <button class="btn btn-dark btn-icon-text" data-action="open-folder">
            <span class="icon"></span>
            <span class="label">打开目录</span>
          </button>
          <button class="btn btn-dark btn-icon-text" data-action="open-hub">
            <span class="icon"></span>
            <span class="label">Mod Hub</span>
          </button>
          <button class="btn btn-primary btn-icon-text" data-action="scan-local">
            <span class="icon"></span>
            <span class="label">扫描本地</span>
          </button>
          <button class="btn btn-success btn-icon-text" data-action="check-update">
            <span class="icon"></span>
            <span class="label">检查更新</span>
          </button>
        </div>
      </header>

      <section class="directory-panel card">
        <div class="directory-row">
          <div class="directory-label">
            <span class="icon"></span>
            <span class="text">工作目录</span>
          </div>

          <div class="directory-input-wrap">
            <input
              class="directory-input"
              type="text"
              readonly
              value="C:\Users\DrewDon\AppData\Roaming\Captain of Industry\Mods"
            />
          </div>

          <button class="btn btn-primary btn-icon-text" data-action="pick-folder">
            <span class="icon"></span>
            <span class="label">选择目录</span>
          </button>
        </div>
      </section>

      <section class="stats-grid">
        <article class="stat-card card stat-total">
          <div class="stat-value">15</div>
          <div class="stat-label">TOTAL MODS</div>
        </article>

        <article class="stat-card card stat-up-to-date">
          <div class="stat-value">0</div>
          <div class="stat-label">UP TO DATE</div>
        </article>

        <article class="stat-card card stat-need-update">
          <div class="stat-value">0</div>
          <div class="stat-label">NEED UPDATE</div>
        </article>

        <article class="stat-card card stat-unknown">
          <div class="stat-value">15</div>
          <div class="stat-label">UNKNOWN</div>
        </article>
      </section>

      <section class="toolbar-row">
        <div class="toolbar-left">
          <div class="search-box">
            <input type="text" placeholder="搜索 Mod..." class="search-input" />
          </div>

          <div class="filter-select-wrap">
            <select class="filter-select">
              <option selected>全部</option>
              <option>可更新</option>
              <option>已最新</option>
              <option>未知</option>
            </select>
          </div>
        </div>

        <div class="toolbar-right">
          <button class="btn btn-dark btn-icon-text btn-disabled" disabled>
            <span class="icon"></span>
            <span class="label">更新全部</span>
          </button>
        </div>
      </section>

      <section class="notice-bar card notice-success">
        <span class="notice-dot"></span>
        <span class="notice-text">扫描完成，共 15 个 Mod。</span>
      </section>

      <section class="table-panel card">
        <div class="table-wrap">
          <table class="mod-table">
            <thead>
              <tr>
                <th class="col-index">#</th>
                <th class="col-mod">MOD</th>
                <th class="col-local-version">本地版本</th>
                <th class="col-hub-version">HUB 版本</th>
                <th class="col-link">链接</th>
                <th class="col-status">状态</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>

            <tbody>
              <tr class="mod-row">
                <td class="cell-index">1</td>
                <td class="cell-mod">
                  <div class="mod-main">Kayser's Automatic Forestry Designations</div>
                  <div class="mod-sub">AutoForestryDesignations</div>
                </td>
                <td class="cell-local-version is-accent">0.1.1</td>
                <td class="cell-hub-version">v0.1.3</td>
                <td class="cell-link">
                  <a href="#" class="hub-link">
                    <span class="icon"></span>
                    <span>Hub</span>
                  </a>
                </td>
                <td class="cell-status">
                  <span class="status-pill status-unknown">? 未知</span>
                </td>
                <td class="cell-actions">
                  <!-- 截图中未见明确按钮，可留空或放 icon button -->
                </td>
              </tr>

              <!-- 其余 mod-row 重复 -->
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</body>
```

## 区块说明

### A. `page-header`

左右分栏。

- 左侧 `brand-block`
  - `h1.page-title`
  - `p.page-subtitle`
- 右侧 `header-actions`
  - 4 个横向按钮
  - 前 2 个深色描边
  - 第 3 个紫色主按钮
  - 第 4 个绿色主按钮

### B. `directory-panel`

单行目录条。

- 左：带文件夹图标的标签 `工作目录`
- 中：长输入框，只读，显示完整路径
- 右：紫色按钮 `选择目录`

### C. `stats-grid`

4 等宽卡片。

- 每个卡片结构一致：
  - `stat-value`
  - `stat-label`
- 数值颜色区分状态：
  - 总数：紫色
  - 已最新：青绿
  - 需更新：橙黄
  - 未知：灰蓝

### D. `toolbar-row`

左右布局。

- 左：搜索框 + 下拉筛选
- 右：`更新全部` 按钮，截图里是禁用态

### E. `notice-bar`

扫描结果提示条。

- 左圆点
- 右文本
- 样式是低对比深色成功提示

### F. `table-panel`

数据表主区域。

- 表头固定
- 行高较高
- 第一列编号
- 第二列双行：
  - 主标题：Mod 显示名
  - 副标题：Mod ID / 目录名
- 版本列为短文本
- 链接列显示小链条图标 + `Hub`
- 状态列显示 pill
- 操作列预留

## 推荐 class 语义

```txt
page
page-shell
page-header
brand-block
page-title
page-subtitle
header-actions

card
btn
btn-dark
btn-primary
btn-success
btn-icon-text
btn-disabled

directory-panel
directory-row
directory-label
directory-input-wrap
directory-input

stats-grid
stat-card
stat-value
stat-label
stat-total
stat-up-to-date
stat-need-update
stat-unknown

toolbar-row
toolbar-left
toolbar-right
search-box
search-input
filter-select-wrap
filter-select

notice-bar
notice-success
notice-dot
notice-text

table-panel
table-wrap
mod-table
mod-row
col-index
col-mod
col-local-version
col-hub-version
col-link
col-status
col-actions

cell-index
cell-mod
cell-local-version
cell-hub-version
cell-link
cell-status
cell-actions

mod-main
mod-sub
hub-link
status-pill
status-unknown
status-updated
status-outdated
```

## 布局约束

### 页面外层

```css
.page-shell {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

### Header

```css
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
```

### 统计卡

```css
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
```

### 工具栏

```css
.toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.toolbar-left {
  display: flex;
  gap: 12px;
}
```

### 表格

```css
.table-wrap {
  overflow: auto;
}

.mod-table {
  width: 100%;
  border-collapse: collapse;
}
```

## 视觉 token 建议

```css
:root {
  --bg: #0f1118;
  --surface: #1a1f2b;
  --surface-2: #232938;
  --border: #30384b;
  --text: #eef2ff;
  --muted: #7f8aa8;

  --primary: #7c5cff;
  --primary-2: #6e59ff;
  --success: #17d3a5;
  --warning: #ffbf5f;
  --unknown: #7382a8;

  --radius: 10px;
  --radius-sm: 8px;
  --gap: 16px;
}
```

## 数据驱动模型

```js
const pageData = {
  title: "COI Mod Manager",
  subtitle: "Captain of Industry · Mod 版本管理与更新",
  workingDirectory: "C:\\Users\\DrewDon\\AppData\\Roaming\\Captain of Industry\\Mods",
  stats: {
    total: 15,
    upToDate: 0,
    needUpdate: 0,
    unknown: 15
  },
  filters: {
    keyword: "",
    status: "全部"
  },
  notice: {
    type: "success",
    text: "扫描完成，共 15 个 Mod。"
  },
  rows: [
    {
      index: 1,
      name: "Kayser's Automatic Forestry Designations",
      id: "AutoForestryDesignations",
      localVersion: "0.1.1",
      hubVersion: "v0.1.3",
      hubUrl: "#",
      status: "未知"
    }
  ]
};
```

## 给 agent 的一句话生成指令

```txt
生成一个深色后台风格的单页 H5 页面，按“顶部品牌区 + 操作按钮区 + 工作目录栏 + 4 个统计卡 + 搜索筛选工具栏 + 扫描结果提示条 + mod 表格”的 DOM 结构实现。表格第二列为双行信息，状态列为圆角 pill，整体配色为深色背景、紫色主色、青绿色强调色。
```
