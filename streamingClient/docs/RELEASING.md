# 发行流程

主程序版本由 `packages/contracts/src/index.ts` 的 `APP_VERSION` 与 package.json 保持一致；每个插件在自己的 `plugin.json` 中维护三段式版本号。

## 构建与打包

```sh
npm ci
npm run check
npm run build:production
npm run package -- --platform win32 --arch x64
npm run package -- --platform darwin --arch arm64
```

产物在 `client/release/`。Windows 要交付完整目录，包含 `ZhudaLive.exe`、DLL 和 `resources/`；macOS 保留完整 `.app`。代码签名、公证和安装器凭据由发行者自行配置。

客户端直接进入场景工作台，不需要账号服务或插件网络。内置玩法随程序提供；真实抖音直播仍需要登录并连接网络。

## 插件更新

插件开发者提高 `plugin.json` 的版本号后重新打包 ZIP，放入用户的插件区。工作台启动和文件变化时自动扫描，同一插件 ID 只启用最高版本，旧版本和插件数据保留以便回退。更新不会要求重装主程序，也不会访问官网。

## 开源源码包

```sh
npm run source:archive
```

归档保留源码、README、文档、许可证、必要资源和锁文件，排除 `.env`、账号数据、密钥、依赖和生成产物。解压后执行 `npm ci`、`npm run check` 和 `npm run build` 即可验证。
