# 审核要点

## 本仓库失败长什么样

1. SSE `error` 把原始 `error.message` 发给客户端。
2. 落库与 `message.committed` 顺序被破坏（应先写入再确认）。
3. `DEEPSEEK_BASE_URL` 可指向任意地址，请求会带上 API key。
4. 表结构变更只用 `IF NOT EXISTS`、没有迁移。
5. 出现原雇主品牌名（茂日、mrkj、Maori）。

## 怎么审

- 每次最多挑少量 nit；风格偏好不要堆。
- 每条意见必须带文件和行号作证据，不要凭名字猜。
- 总结开头先写问题数量（没有就写 0）。
- 重审只看新增 diff；审稿最多约 3 轮，到顶就请人定方向。
- 可跳过：`package-lock.json`、生成物、`node_modules`。
