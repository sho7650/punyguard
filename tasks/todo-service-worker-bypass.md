# Service Worker が応答する遷移の遮断 計画（未着手）

[todo-security-hardening.md](todo-security-hardening.md) の Phase 2 で、Service Worker が応答する遷移には declarativeNetRequest が効かないと分かった（[docs/decisions.md](../docs/decisions.md) の P3）。特にユーザー情報付き URL は、攻撃者が自分のサイトに一度来させて Service Worker を登録させれば、PunyGuard を入れた後でもすり抜けられる。この計画で対策を設計から詰める。

## 分かっていること（2026-10-18 に Chromium で確認）

- Service Worker が自分で作った応答は、IDN ホストでもユーザー情報付き URL でも遮断されない
- `fetch(event.request)` で中継すると、IDN ホストではリクエストがサーバーに届き、遮断されない。ユーザー情報付き URL では Chrome が拒否して読み込まれない
- Service Worker が応答しないパスは遮断される

## 詰めること

- [ ] 候補を比べる: `webNavigation.onBeforeNavigate` / `onCommitted` で見つけて `tabs.update` で警告ページに移す案、ほかの案
- [ ] 増える権限と、インストール時・更新時の警告文の変化
- [ ] 中身が一瞬表示されることの扱いと、iframe・`<object>`・`<embed>` の中の遷移の扱い
- [ ] Service Worker が応答する遷移を再現する E2E テストの作り方（安全なオリジンの扱い）
