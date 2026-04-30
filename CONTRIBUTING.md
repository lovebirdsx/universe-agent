# 贡献指南

## 开发

``` bash
pnpm run dev 		        # 启动开发环境
pnpm run typecheck          # 进行类型检查
pnpm run lint               # 进行代码检查
pnpm test                   # 运行所有测试
pnpm run check              # 类型检查 + 代码检查 + 测试
```

## 发布

* 在 npm 网站上生成一个 Granular Access Token，勾选 `Bypass two-factor authentication (2FA)`
* 将 token 添加到 ~/.npmrc 文件中，格式为 `//registry.npmjs.org/:_authToken=YOUR_TOKEN`

### 本地发布

``` bash
pnpm changeset              # 选择包和bump类型，填写变更描述
pnpm version-packages       # 应用版本号
pnpm publish-packages       # 发布到 npm
git push --follow-tags      # 推送代码和标签
```

### github 发布

* GitHub仓库添加一个新的 Secret：
  * 在 npm 网站上生成一个 Granular Access Token，勾选 `Bypass two-factor authentication (2FA)`
  * Settings → Secrets and variables → Actions → New repository secret
  * 名称为 `NPM_TOKEN`，值为上面生成的 Granular Access Token。

``` bash
pnpm changeset              # 选择包和bump类型，填写变更描述
git push                    # 推送代码，触发 GitHub Action 发布流程
```

* github上会自动创建一个 Pull Request，包含版本更新和发布日志，检查无误后合并即可完成发布

## 发布前测试

### 模拟全局安装

``` bash

# 在各包目录下执行
cd packages/cli && npm link
cd packages/acp && npm link
cd packages/acp-client && npm link

# 然后在任意目录直接使用
universe-agent --help
universe-agent-acp --help
universe-agent-acp-client --help

# 测试完后取消链接
npm remove -g @universe-agent/cli
npm remove -g @universe-agent/acp
npm remove -g @universe-agent/acp-client
```

### 模拟真实安装

``` bash
# 先构建
pnpm build

# 打包成 .tgz（和 npm publish 发布的内容一致）
cd packages/cli && npm pack
# 生成 universe-agent-cli-1.0.0.tgz

# 在另一个目录安装测试
cd /tmp/test-project
npm install /path/to/universe-agent-cli-1.0.0.tgz
npx universe-agent --help
```

### 检查发布内容

``` bash
cd packages/cli && npm pack --dry-run
cd packages/acp && npm pack --dry-run
cd packages/acp-client && npm pack --dry-run
```
