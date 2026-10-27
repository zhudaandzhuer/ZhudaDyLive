# 可选服务部署

桌面客户端可以直接启动。服务端只用于托管介绍网站和可选的桌面发行包下载；客户端不会依赖它来启动或更新插件。

## 配置

```dotenv
NODE_ENV=production
LIVE_HOST=127.0.0.1
LIVE_PORT=8787
LIVE_PACKAGE_DIR=/srv/zhuda-live/packages
LIVE_PRIVATE_KEY_FILE=/run/secrets/zhuda-live-private.pem
LIVE_PUBLIC_KEY_FILE=/etc/zhuda-live-public.pem
```

客户端直接读取本机插件 ZIP，不会从服务端下载或更新插件。发布时只需分发对应平台的桌面安装包和插件 ZIP。

## 备份

备份网站配置和桌面发行包。桌面用户数据位于 Electron `userData`，其中 `plugins/inbox` 是插件投递目录，`plugins/<id>/<version>` 是已安装版本，`studio.sqlite` 保存场景和设置。

如果只需要分发开源桌面产品，可以不部署服务端，直接发布对应平台的压缩包和 README。
