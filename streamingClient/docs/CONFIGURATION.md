# 配置说明

复制 `.env.example` 为 `.env`。桌面客户端可以完全离线打开；只有抖音登录和直播数据需要网络。

| 变量                                             | 用途                             |
| ------------------------------------------------ | -------------------------------- |
| `NODE_ENV`                                       | `production` 启用生产构建限制    |
| `LIVE_ROOT`                                      | 编译服务定位项目资源             |
| `LIVE_PACKAGE_DIR`                               | 内置游戏包和本机构建包目录       |
| `LIVE_PRIVATE_KEY_FILE` / `LIVE_PUBLIC_KEY_FILE` | 正式插件包签章密钥               |
| `LIVE_CLIENT_DATA_DIR`                           | 开发时覆盖 Electron 用户数据目录 |

`LIVE_SCENE_SMOKE_*` 和 `LIVE_SMOKE_*` 只供隔离验收或开发原型使用。

`.env`、Cookie、SQLite、密钥、日志和构建产物不进入源码归档。插件开发者只需要把 ZIP 放入工作台显示的本机插件区。
