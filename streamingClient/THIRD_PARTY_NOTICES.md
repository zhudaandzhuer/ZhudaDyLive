# 第三方声明

本项目原创代码和项目素材按根目录 MIT 许可证提供。外部依赖与数据保留各自许可，不因本项目开源而改变。依赖版本以 `package-lock.json` 为准。

## 直播协议字段

`packages/core/src/protocol.ts` 的 Protobuf 字段编号子集参考 [jwwsjlm/douyinlive-proto](https://github.com/jwwsjlm/douyinlive-proto) v0.1.3。未分发 Go 运行时或上游生成的 Go 代码，保留其完整 MIT 声明：

```text
MIT License

Copyright (c) 2026 jwwsjlm

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm、Electron 与字典

构建将运行依赖及其传递依赖的许可证／NOTICE 复制到桌面和服务端 `dist/licenses/`，并生成 `dependencies.json` 清单。运行 `npm ci` 后也可在相应 `node_modules` 包中查看上游声明。

- Electron 分发包保留自带的 `LICENSE`、`LICENSES.chromium.html` 及其他运行时声明；打包时不得删除。
- 局域网二维码使用 qrcode、pngjs 和 dijkstrajs，均保留 MIT 声明。
- abstract-logging 2.0.1 的 npm 包仅链接许可证网页，仓库在 `licenses/abstract-logging-MIT.txt` 保留该上游完整声明，构建时一并分发。
- [opencc-js](https://github.com/nk2028/opencc-js) 使用 MIT；其字典由 opencc-data 生成，按 Apache-2.0 再分发。完整声明保留在构建的 `opencc-js` 许可证和第三方文件中，另保留兼容的独立许可文件。
- React、Fastify、Protobuf、压缩、schema 等依赖的具体版本、许可与文件名见构建清单。开发工具依赖不自动成为应用代码，但再分发这些工具时仍需保留其许可。

## 图片、拟音与平台数据

当前锁链及缝纫机音效是本项目程序化合成的金属、摩擦与机械拟音，不含外部录音、音乐、人声或 SoundFont。旧配乐源与未使用影片不在公开源码中。当前 PNG、图形代码和拟音来源见 [素材说明](docs/ASSETS.md)。

礼物目录快照及运行时使用的平台名称、图标和 URL 保留平台相应权利；它们不属于本项目原创 MIT 美术。用户自己导入的媒体由用户确保具有相应使用权。
