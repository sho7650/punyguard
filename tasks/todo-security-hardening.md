# セキュリティレビュー後の対策 実装計画

2026-10-17 に `src/` と `manifest.json` のセキュリティレビューをした。HIGH と MEDIUM の脆弱性は見つからなかった。この計画では、レビューで対象外とした 5 件の扱いを決め、対策が要るものに手を入れる。

- 用語: [CONTEXT.md](../CONTEXT.md)（遮断、警告ページ）
- 判断の記録: [docs/decisions.md](../docs/decisions.md)
- 前の計画: [todo-userinfo-ip.md](todo-userinfo-ip.md)
- 合意: 2026-10-17 の設計の詰め（Q1 から Q5。すべて推奨案を採用）

## 5 件の扱い

| #   | レビューで対象外とした項目                                                               | 扱い                                      |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | `<object>` / `<embed>` で読み込む内容が遮断されない                                      | 対策する（Phase 1）                       |
| 2   | 拡張機能より前に登録された Service Worker が応答する遷移を遮断できるか分からない         | 調べて記録する（Phase 2）                 |
| 3   | `blocked.html` の URL が固定なので、拡張機能が入っていることを外部のページから判定できる | 受け入れて記録する（Phase 3）             |
| 4   | シークレットモードやサイトへのアクセス制限の下では遮断が効かない                         | 作業なし。README の 73〜90 行目で案内済み |
| 5   | `console.error` が設定オブジェクトをログに出す                                           | 作業なし。設定に機密は含まれない          |

## 受け入れ基準

### 埋め込まれた文書（#1）

- [x] `<object data="https://xn--...">` と `<embed src="https://xn--...">` で読み込む内容が、iframe と同じように遮断される
- [x] IP アドレスホストも、同じく `<object>` / `<embed>` で遮断される。プライベート IP アドレスの除外も、iframe のときと同じに働く
- [x] IDN ホストと IP アドレスホストを理由に遮断された `<object>` / `<embed>` の中身は、警告ページに置き換わる。空の表示や Chrome の標準エラー画面では合格としない。ボタンは iframe のときと同じく隠れる
- [x] ユーザー情報付き URL の埋め込み（iframe、`<object>`、`<embed>`）は、Chrome 自身がネットワークに出す前に拒否するので、警告ページには置き換わらない。これも**遮断**として扱う（CONTEXT.md の例外）。この拒否は PunyGuard の設定と関係なく働くので、ユーザー情報付き URL の遮断を無効にしていても、埋め込まれた文書は読み込まれない。受け入れ基準は、テストサーバーにリクエストが届かないことと、埋め込みの中に警告ページが表示されないことにする。どちらも、ユーザー情報付き URL の遮断を有効にしたときと無効にしたときの両方で確かめる
- [x] IDN ホストと IP アドレスホストの E2E テストは、`object` をルールに足さなければ失敗する形にする。埋め込み先には実際に応答するホストを使い、(1) テストサーバーにリクエストが届いていないこと、(2) 埋め込みの中に警告ページが表示され、遮断理由が示されていることの両方を確かめる。応答元のない `PUBLIC_IP_URL`（RFC 5737）は、遮断がなくても読み込まれないので、この確認には使わない
- [x] ユーザー情報付き URL の埋め込みの E2E テストは、Chrome 自身が拒否するので `object` を足す前から通る。RED を求めず、Chrome の振る舞いが変わったときに気づくための回帰テストとして置く。PunyGuard の転送が Chrome の拒否の代わりに働いてもテストが通ってしまわないよう、警告ページが表示されないことも確かめる。ユーザー情報付き URL の遮断を無効にしたケースでは PunyGuard のルール自体がないので、Chrome が拒否しなくなればリクエストが届いてテストが落ちる
- [x] IDN ホストか IP アドレスホストの `<object>` / `<embed>` の中に警告ページを表示できないと実装中に分かったときは、作業を止めて依頼者と仕様を決め直す（CONTEXT.md を変えるかどうか）
- [x] ASCII ホストの `<object>` / `<embed>`（PDF の埋め込みなど）は今までどおり表示される
- [x] README（日本語と英語）の「ページ全体と iframe」を、`<object>` / `<embed>` を含む書き方に直す。ユーザー情報付き URL の埋め込みは警告ページではなく Chrome が拒否すること、その拒否は設定で無効にできないことも書く。設定の説明（ユーザー情報付き URL の遮断を無効にする項目）にも、埋め込まれた文書には効かないと書く

### Service Worker（#2）

- [x] Chrome のドキュメントと issue で、Service Worker が応答するナビゲーションに declarativeNetRequest が効くかを確かめる
- [x] 結果と判断を `docs/decisions.md` に記録する。効かないと分かった場合は、対策を検討するかを改めて決める

### 拡張機能の検出（#3）

- [x] `use_dynamic_url: false` のままにする判断と理由を `docs/decisions.md` に記録する

### 全体

- [ ] `pnpm run check` と E2E テストが CI で通る（手元では通過。CI はプッシュ後）

## 作業

### Phase 1: `<object>` / `<embed>` の遮断（TDD）

1. [x] `src/core/block-rule.test.ts:235` の期待値に `object` を足し、失敗することを確かめる（単体テストの RED）
2. [x] `e2e/support/server.ts` に、`<object>` と `<embed>` で埋め込むページを足す。埋め込み先は、IDN ホスト（`idnUrl`）、到達できる IP ホスト（`http://127.0.0.1:<port>/...`）、ユーザー情報付きの ASCII ホスト（`http://user@ascii.test:<port>/...`）にする。ユーザー情報付きは iframe のページも足す
3. [x] テストサーバーが、埋め込み先へのリクエストを記録するようにする。今は IDN ホストへのリクエスト（`idnRequests`）しか記録しない。ユーザー情報はリクエストに載らないので、IP ホストとユーザー情報付き URL の埋め込み先には専用のパスを使い、そのパスへのリクエストを記録する
4. [x] `e2e/blocking.spec.ts` と `e2e/userinfo-ip.spec.ts` に、IDN ホストと IP ホストの `<object>` と `<embed>` のケースを足す。各ケースで、記録されたリクエストが空であることと、埋め込みの中に警告ページと遮断理由が出ることを確かめる。この時点で走らせ、失敗することを確かめる（E2E の RED）
5. [x] `e2e/userinfo-ip.spec.ts` に、ユーザー情報付き URL の iframe、`<object>`、`<embed>` のケースを足す。ユーザー情報付き URL の遮断が有効な既定の設定と、無効にした設定の両方で、記録されたリクエストが空であることと、埋め込みの中に警告ページが表示されていないことを確かめる。Chrome 自身が拒否するので、この時点で通る（回帰テスト）
6. [x] `src/core/block-rule.ts:40` の `RESOURCE_TYPES` に `object` を足す（GREEN）。IDN、ユーザー情報、パスワード、プライベート IP の許可の各ルールが同じ定数を使っていることを確かめる。単体テストと 4・5 の E2E テストが通ることを確かめる
7. [x] 警告ページのボタンが `<object>` / `<embed>` の中でも隠れることを確かめる。`window.top !== window` の判定で隠れなければ、判定を見直す
8. [x] 6 の後も、IDN ホストか IP ホストの埋め込みに警告ページを表示できない場合は、ここで作業を止めて依頼者に相談する
9. [x] README.md と README.ja.md の対象表を直す

### Phase 2: Service Worker の調査

- [x] Chrome の declarativeNetRequest のドキュメントと Chromium の issue を調べる
- [x] `docs/decisions.md` に P3 として記録する

### Phase 3: 判断の記録

- [x] `docs/decisions.md` に P4「`blocked.html` は固定 URL のまま公開する」を記録する
  - **理由**: 拡張機能が入っていると知った攻撃者は `xn--` を避けた別の手口に切り替えるだけで、その手口はもともと PunyGuard が守る範囲の外にある。知られても守りは弱まらない

### Phase 4: 仕上げ

- [x] `direnv exec . pnpm run check`
- [x] `direnv exec . pnpm run test:e2e`
- [x] コードレビュー
- [x] この計画にレビュー結果を書き足す

## レビュー

2026-10-18

### 結果

- `RESOURCE_TYPES` に `object` を足した。単体テストは、2 つの設定ですべてのルール（ID 1〜9）を確かめる形に広げた
- 単体テストと E2E テストは、どちらも RED を確かめてから GREEN にした。`object` を外すと、IDN ホストと IP アドレスホストの `<object>` / `<embed>` の 4 件だけが落ちることも確かめた
- ユーザー情報付き URL の埋め込み 6 件は、計画どおり `object` を足す前から通った（回帰テスト）
- 手元では `pnpm run check`（単体 289 件）と E2E 61 件（macOS で飛ばす言語テスト 3 件を除く）が通る。CI はプッシュ後に確かめる

### 計画から変えたこと

- E2E テストは `blocking.spec.ts` と `userinfo-ip.spec.ts` ではなく、新しい `e2e/embedded-documents.spec.ts` にまとめた。`userinfo-ip.spec.ts` が lint の行数の上限（300 行）を超えるため
- Playwright の `frameLocator` は iframe しか受け付けないので、`<object>` / `<embed>` の中の文書は `e2e/support/embedded-frame.ts` の `embeddedFrame` で `page.frames()` から探す

### Service Worker（#2）

- 効かないと分かった。Service Worker が自分で作った応答も、`fetch()` で中継した応答も遮断されない
- コードレビューで、ユーザー情報付き URL は導入後もすり抜けられると指摘があり、Chromium で確かめた。攻撃者が自分のサイトに一度来させて Service Worker を登録させれば、`https://paypal.com@evil.example/` は止まらない
- 依頼者の判断で、今回は P3 と README に正しい範囲を記録するところまでとした。対策は [todo-service-worker-bypass.md](todo-service-worker-bypass.md) で設計から詰める

### コードレビューの指摘

- P3 と README の影響の範囲が IDN ホストにしか当てはまらない → 上のとおり確かめて直した
- README の表の「サブリソースは止めない」が、`<object>` / `<embed>` 経由では成り立たない → 表を直した
- テスト名の「inside it only」と「inside it」の違い → 既存の iframe テストと同じ分け方なので、そのままにした

### Codex による PR レビュー（PR #12）

- ユーザー情報付き URL の埋め込みには、Chrome が拒否しない例外がある。埋め込んだページ自体が同じオリジンの同じユーザー情報付き URL で開かれている場合で、ユーザー情報付き URL の遮断を無効にしたときだけ起きる。Chromium で確かめた
- 依頼者の判断で、実装は変えず、CONTEXT.md と README（日英）に例外を書き足した。例外の振る舞いを確かめる回帰テストを E2E に 3 件足した
