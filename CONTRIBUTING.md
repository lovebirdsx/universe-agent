# Contributing to Universe Agent

## Development

``` bash
pnpm run dev 		        # 启动开发环境
pnpm run typecheck          # 进行类型检查
pnpm run lint               # 进行代码检查
pnpm test                   # 运行所有测试
pnpm run check              # 类型检查 + 代码检查 + 测试
```

## Publish

* 在 npm 网站上生成一个 Granular Access Token，勾选 `Bypass two-factor authentication (2FA)`
* 将 token 添加到 ~/.npmrc 文件中，格式为 `//registry.npmjs.org/:_authToken=YOUR_TOKEN`

``` bash
pnpm changeset              # 选择包和bump类型，填写变更描述
pnpm version-packages       # 应用版本号
pnpm publish-packages       # 发布到 npm
git push --follow-tags      # 推送代码和标签
```
