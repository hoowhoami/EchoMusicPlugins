# WebDAV 备份

把 EchoMusic 的应用设置、已安装插件及插件数据保存到你自己的 WebDAV 存储，并从主程序的“备份与恢复”界面读取和恢复。

## 使用方法

1. 安装并启用“WebDAV 备份”插件。
2. 在插件设置中填写 WebDAV 服务地址、用户名、密码和远端目录。
3. 点击“测试连接”；插件会检查访问权限，并在需要时创建远端目录。
4. 点击“保存并应用”。配置有效后，EchoMusic 设置页的“备份与恢复”会出现“WebDAV 备份 · WebDAV 备份”存储位置。
5. 在主程序中选择该位置创建或恢复备份。

插件只负责 WebDAV 的保存、列举、读取和删除请求。备份归档、内容范围、格式校验、恢复回滚和应用重启均由 EchoMusic 主程序处理。

## 常见服务地址

- Nextcloud：`https://example.com/remote.php/dav/files/用户名/`
- 坚果云：`https://dav.jianguoyun.com/dav/`
- 自建 WebDAV：填写服务器提供的 WebDAV 根目录 URL

请不要把用户名和密码写进 URL。插件使用 HTTP Basic Authorization，推荐使用 HTTPS 和服务端提供的应用专用密码。

## 凭据与备份安全

- “记住密码”默认关闭。关闭时密码仅在当前 EchoMusic 运行会话中有效，重启后需要重新输入并保存。
- 开启“记住密码”后，密码会保存在插件 storage 中；该存储不是系统钥匙串。
- EchoMusic 备份目前不加密，可能包含插件账号与私有数据。任何拿到备份文件或能访问 WebDAV 目录的人都可能读取这些内容。

最低要求：EchoMusic `2.3.1-beta.20`。
