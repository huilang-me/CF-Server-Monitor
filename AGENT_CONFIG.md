# 探针动态配置协议

新版探针在指标上报请求中携带以下请求头：

```text
X-Agent-Config-Schema: 1
X-Agent-Config-Md5: <最后成功应用的配置 MD5，首次为 none>
```

服务端仅对以下规范配置串计算 MD5。字段顺序、大小写和分隔符不可改变：

```text
collect_interval=0&ping_mode=http&report_interval=60&reset_day=1&schema_version=1
```

响应规则：

- 未携带 `X-Agent-Config-Schema`：按旧版协议返回 `200 OK`。
- MD5 一致：返回 `204 No Content`。
- MD5 不一致：返回 `200 application/x-www-form-urlencoded`，响应体为完整规范配置串，并通过 `X-Agent-Config-Md5` 返回新 MD5。

客户端必须整体校验配置：

- `collect_interval` 只能是 `0/1/2/5/10`。
- `report_interval` 只能是 `30/60/120/180`，且不能小于采集间隔。
- `ping_mode` 只能是 `http/tcp`。
- `reset_day` 必须为 `0..31` 的整数。
- `schema_version` 必须等于 `1`。
- 响应体不得超过 512 字节，不接受重复字段、未知字段、百分号编码、空格或换行。

客户端只有在完整校验和原子持久化均成功后才能保存新 MD5。失败时继续使用旧配置和旧 MD5，以便下次上报重新获取。

动态配置不包含 `server_id`、`secret`、`worker_url`、调试开关、流量校正或任何命令类字段。
