# PunyGuard 実装計画

IDN ホスト（ラベルのどれかが `xn--` で始まるホスト）への遷移を、経路を問わずに遮断する Chrome 拡張機能（Manifest V3）を作る。遮断した遷移は、拡張機能に同梱した警告ページに置き換える。

- 用語: [CONTEXT.md](../CONTEXT.md)
- 判断の記録: [ADR-0001 すべての IDN ホストを例外なく遮断する](../docs/adr/0001-block-all-idn-hosts.md)、[ADR-0002 同梱の警告ページへ転送する](../docs/adr/0002-redirect-to-bundled-warning-page.md)
- 参考記事: https://www.gizmodo.jp/article/2610-chrome-phishing-domain-bypass/
- テンプレート: https://github.com/sho7650/copier-ts7

## 背景

Chrome は紛らわしい文字を含むドメインを Punycode で表示する。しかし、その判定に使う文字リストに `ө`（U+04E9）が入っていなかった。そのため、5文字すべてがキリル文字の `аррӏө.com`（`xn--80a6aa68c8d.com`）は Chrome 154 でも Unicode のまま表示され、`apple.com` と見分けがつかなかった。類似度による判定はこうした漏れを避けられないので、PunyGuard は IDN ホストを一律に止める。

## 対象と対象外

| 対象                                                                 | 対象外                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| ホスト名に `xn--` ラベルを含む遷移（TLD も含む）                     | パスやクエリの非 ASCII 文字（`ja.wikipedia.org/wiki/東京` は通す） |
| ページ全体の遷移（`main_frame`）と iframe（`sub_frame`）             | 画像やスクリプトなどのサブリソース                                 |
| クリック、アドレスバー入力、リダイレクト、外部アプリから開いたリンク | 許可リスト、警告ページから先へ進む操作（ADR-0001）                 |
| 日本語と英語の UI                                                    | Chrome Web Store での公開。配布は GitHub だけにする                |

元の要件は「URL に英語 ASCII 以外の文字が混入していたら」だった。判定対象をホスト名だけにすることは、計画を作る段階で依頼者と合意した（2026-10-15）。パスやクエリの非 ASCII 文字まで止めると `ja.wikipedia.org/wiki/東京` のようなページも止まり、実用に耐えない。また、送信される時点でパスはパーセントエンコードされた ASCII になっているので、「非 ASCII を含むか」という判定がうまく定義できない。「クリックを拒否」も、同じ場で「経路を問わずに遮断する」に広げた。

## 受け入れ基準

- [ ] `https://аррӏө.com/` をアドレスバーに入力すると、警告ページが表示される
- [ ] ASCII ホストのページにある IDN リンクをクリックすると、警告ページが表示される
- [ ] ASCII ホストから IDN ホストへ 302 でリダイレクトされると、警告ページが表示される
- [ ] IDN ホストの iframe は、その iframe の中だけが警告ページになる。表示内容はページ全体の場合と同じで、操作ボタン（「このタブを閉じる」と「前のページに戻る」）だけを出さない
- [ ] `allow-scripts` のない `sandbox` 属性付き iframe でも、IDN ホストの中身は表示されない。警告文が表示されるかどうかは問わない（転送が成り立てば日英併記の固定の警告文が出る。成り立たなければ読み込みが失敗する。どちらでも遮断としては成り立つ）
- [ ] 警告ページに、元の URL（リンクにはしない）、Unicode 表記、Punycode 表記、非 ASCII 文字ごとの文字種とコードポイントが表示される
- [ ] 警告ページには「このタブを閉じる」（主ボタン）が常にあり、押すとタブが閉じる
- [ ] 「前のページに戻る」（副ボタン）は `history.length > 1` のときだけ表示され、押すと `history.back()` で前のページに戻る。新しいタブの最初のページとして警告ページが開いたときは表示されない
- [ ] ASCII ホストへの遷移には影響しない（パスが日本語でも）。ただし、userinfo に `xn--` を含む URL（例: `https://xn--a@example.com/`）は例外で、既知の誤検知として遮断される（「将来」節を参照）
- [ ] 外部アプリから開いたリンクでも、警告ページが表示される（手動確認: ターミナルで `open -a "Google Chrome" "https://аррӏө.com/"` を実行する）
- [ ] Chrome の表示言語が日本語なら日本語で、それ以外なら英語で表示される
- [ ] 拡張機能を再読み込みしたり、置き場所を変えて ID が変わったり、ブラウザを再起動したりしても、遮断が続く
- [ ] 遮断が効いていない状態になったら、ツールバーアイコンのバッジに `!` が出る。対象は、遮断ルールの登録に失敗したときと、利用者がサイトへのアクセス権を「すべてのサイト」以外（「クリック時」や特定のサイトだけ）に制限したとき
- [ ] 既知の制限: 警告ページが新しいタブの最初のページで、そこから別のページへ移り、ブラウザの戻るボタンで警告ページに戻ってきた場合（前の履歴はなく、先の履歴だけがある状態）は、「前のページに戻る」が表示されるが、押しても何も起きない。この状態でも「このタブを閉じる」は使える
- [ ] `pnpm run check` と E2E テストが CI で通る

## 設計

### 構成

```
manifest.json            MV3。permissions: declarativeNetRequest / host_permissions: <all_urls>
_locales/{ja,en}/messages.json
src/
  background.ts          onInstalled と onStartup で遮断ルールを登録し直し、権限の変化も監視する。遮断が効かない状態ならバッジで知らせる
  blocked.html / .ts / .css  警告ページ
  core/
    block-rule.ts        遮断ルールを組み立てる純粋関数
    protection.ts        ルールの登録、サイトへのアクセス権の確認、バッジの更新（ブラウザ API は引数で受け取る）
    blocked-url.ts       警告ページのフラグメントから元の URL を取り出して検証する
    host-description.ts  ホスト名を Unicode に戻し、文字ごとの文字種とコードポイントを求める
scripts/build.ts         esbuild でバンドルし、manifest・HTML・CSS・_locales を dist/ にコピーする
e2e/                     Playwright
```

### 遮断の仕組み

- 動的ルールを1本だけ使う。
  - `condition.regexFilter`: `^https?://(?:[^/?#]*[.@])?xn--` に相当する RE2 の正規表現。ラベルの先頭が `xn--` のときに一致させる
  - `condition.resourceTypes`: `["main_frame", "sub_frame"]`
  - `action.redirect.regexSubstitution`: `${chrome.runtime.getURL("blocked.html")}#\0`。元の URL をフラグメントで渡す
- 拡張機能の ID がルールに入るので、静的ルールにはしない。`runtime.onInstalled`（インストール、更新、再読み込みのたびに発火する）と `runtime.onStartup`（ブラウザの起動時に発火する）の両方で `updateDynamicRules` を呼び、既存の ID を削除してから追加する。動的ルールは再起動後も残るはずだが、それを前提にしないために onStartup でも登録する。
- `regexSubstitution` で置き換わるのは、URL のうち正規表現に一致した部分だけで、残りはそのまま後ろにつながる。正規表現は `^` で先頭に固定しているので、`https://xn--` の部分が `chrome-extension://<ID>/blocked.html#https://xn--` に置き換わり、残りのホスト名とパスがフラグメントの続きになる。結果として、元の URL 全体がフラグメントに入る。`^` を外すと、元の URL の先頭部分が転送先の前に残って URL が壊れる。
- `blocked.html` を `web_accessible_resources` に `{ "resources": ["blocked.html"], "matches": ["<all_urls>"], "use_dynamic_url": false }` として登録する。
  - `matches` を `<all_urls>` にするのは、どのサイトからのクリック、リダイレクト、iframe でも転送できるようにするため。狭くすると、対象外のサイトからの転送が失敗する
  - `use_dynamic_url` を `true` にすると URL がセッションごとに変わり、登録済みのルールの転送先が古くなる
- DNR はホスト名を Punycode に直してから照合するので、Unicode で入力された URL も同じルールで捕まる。

### 正規表現の検証と、登録に失敗したときの通知

- `regexFilter` は JavaScript の正規表現ではなく RE2 で解釈される。RE2 は先読み、後読み、後方参照を持たず、Chrome はコンパイル後のサイズが 2KB を超える正規表現も拒否する。Vitest は V8 の正規表現で動くので、RE2 で使えない構文があっても単体テストは通ってしまう。
- そのまま登録すると `updateDynamicRules` が失敗してルールが1本も入らない。それでも見た目には何も起きず、何も遮断されない。これを2段階で防ぐ。
  - 開発時: E2E で拡張機能の service worker から `chrome.declarativeNetRequest.isRegexSupported({ regex })` を呼び、`isSupported: true` を確かめる。構文とサイズの上限の両方を Chrome 自身が判定する。
  - 利用時: `updateDynamicRules` が失敗したら、`console.error` にエラーを出し、ツールバーアイコンのバッジに `!` を出す。バッジを消すのは、登録に成功し、かつ下の「サイトへのアクセス権の監視」でも問題がなかったときだけ。manifest に `action` を書く必要があるが、権限は増えない。ポップアップは作らない。
- ネイティブの `re2` パッケージで単体テストする案は採らない。このパッケージは JavaScript の書き方を RE2 の書き方に翻訳してからコンパイルする。そのため、Chrome（翻訳しない）では拒否される書き方がテストを通ってしまう。RE2 のバージョンも Chrome と違い、サイズの上限も確かめられない。そのうえ、ネイティブのビルド環境が必要になる。

### サイトへのアクセス権の監視

- DNR の `redirect` は、転送する URL へのホスト権限がないと働かない。利用者が Chrome の拡張機能画面で、サイトへのアクセスを「クリック時」や特定のサイトだけに制限すると、ルールの登録は成功したまま、IDN ホストへの転送だけが働かなくなる。そのままでは、バッジが空のまま保護が止まる。
- `chrome.permissions.contains({ origins: ["<all_urls>"] })` で、すべてのサイトへのアクセス権があるかを確かめる。ない場合もバッジに `!` を出す。`permissions` API は権限の宣言なしで使える。
- 確かめるタイミング: `runtime.onInstalled`、`runtime.onStartup`、`permissions.onAdded`、`permissions.onRemoved`。
- バッジの `!` は「遮断が効いていない」ことを表す。原因（ルールの登録の失敗か、アクセス権の不足か）は、アイコンのツールチップ（`action.setTitle`）で示す。
- README に「サイトへのアクセスは『すべてのサイト』のままにする」と書く。

### 警告ページ

- スクリプトが動かなくても警告として成り立つように作る。`allow-scripts` のない sandbox 付き iframe に転送されると、sandbox の制約が引き継がれて `blocked.ts` が実行されないため。
  - `blocked.html` には、日英併記の固定の警告文（「PunyGuard がこのページへの移動を止めました / PunyGuard blocked this page」と、国際化ドメインを止める拡張機能であることの短い説明）を最初から書いておく
  - 詳細の欄と操作ボタンは、HTML では `hidden` にしておく。`blocked.ts` が動いたときだけ、固定の文言をブラウザの言語の文言に差し替え、詳細を埋めて表示する
- `location.hash` から元の URL を取り出す。ウェブページ側からも任意のフラグメントを付けてこのページを開けるので、中身は信用しない。
  - 解析できない URL のときは、ホスト情報を出さずに汎用の文言を表示する
  - DOM への出力はすべて `textContent` で行い、`innerHTML` は使わない
  - 元の URL へ移動する操作やコピーする操作は用意しない
- 表示する内容: 元の URL、ホストの Unicode 表記と Punycode 表記、非 ASCII 文字の一覧（文字、文字種、`U+XXXX`）
- 文字種は `\p{Script=...}` で判定する（Latin / Cyrillic / Greek / Armenian / Han / Hiragana / Katakana / Hangul / Arabic / Hebrew / Thai、どれにも当てはまらなければ Other）。
- 操作ボタンは2つに分ける。iframe の中に表示されているときは、どちらも出さない（iframe から親のタブを閉じたり戻したりしないため）。
  - 「このタブを閉じる」（主ボタン、常に表示）: `chrome.tabs.getCurrent()` で自分のタブを取得し、`chrome.tabs.remove()` で閉じる（`tabs` 権限は要らない）。不審なリンクから離れるという目的に一番合うので、主ボタンにする
  - 「前のページに戻る」（副ボタン）: `history.length > 1` のときだけ表示し、押すと `history.back()` を呼ぶ
- 「前に戻れる履歴があるか」を自動で判定して、1つのボタンで戻るか閉じるかを切り替える方式は採らない。ブラウザには、別オリジンも含めて前に戻れる履歴があるかを正確に調べる手段がないため。
  - `navigation.canGoBack`（Navigation API）は、同一オリジンで連続する履歴しか見えない。警告ページ（`chrome-extension://`）にはほぼ必ず別オリジンのページから来るので、前のページがあっても `false` になる
  - `history.length` は履歴の総数で、今いる位置より前に履歴があるかは分からない。先の履歴だけがある状態でも 2 以上になる
  - `history.back()` を呼んで一定時間たってもページが残っていたら閉じる、という方式は、待ち時間で判定するので、重いページへ戻る途中でタブが閉じるおそれがある
  - そのため、`history.length > 1` で「前のページに戻る」を表示する判定は不正確なまま受け入れる。外れるのは先の履歴だけがある状態で、そのときはボタンを押しても何も起きない（受け入れ基準の「既知の制限」）
- 文言は `chrome.i18n.getMessage` で引く。HTML の固定の文言（日英併記）も、スクリプトが動いたときに差し替える。

### ツールチェーン

- テンプレート（TS 7.0 の `tsc`、Vitest 5、oxlint、oxfmt、Nix と direnv、pnpm）をベースにする。
- tsconfig は2つに分ける。
  - `tsconfig.json`（`src/`）: `module: "preserve"`、`moduleResolution: "bundler"`、`lib: ["esnext", "dom"]`、`types: ["chrome"]`
  - `tsconfig.node.json`（`scripts/`、`e2e/`、`*.config.ts`）: テンプレートの Node 向け設定のまま
- バンドラーは esbuild。依存は npm の `punycode` だけ（Punycode を Unicode に戻すため）。
  - `punycode` は Node の組み込みモジュール（非推奨）と同じ名前なので、import は `"punycode/"`（末尾にスラッシュ）と書く。こう書くと、Vitest（Node）でも esbuild（ブラウザ向け）でも npm 版に解決され、テストしたものと配布物が一致する。
  - npm 版は型定義を同梱していない。`@types/punycode` が `"punycode/"` の import に効くかを確かめ、効かなければ `src/types/punycode.d.ts` で、使う `toUnicode` だけを宣言する。
- 単体テストは `src/core/` だけを対象にする。ブラウザ API に触れる薄い入口（`background.ts`、`blocked.ts`）はカバレッジ計測から外し、E2E で確認する。

## Phase 0: プロジェクト生成

- [ ] `copier copy gh:sho7650/copier-ts7 .` で生成する（project_name: `punyguard`）。既存の `CONTEXT.md`、`docs/`、`tasks/` が上書きされないことを確認する
- [ ] `direnv allow` → `pnpm install` → `pnpm run check` が通ることを確認する
- [ ] `git init`。最初のコミットは `chore: initial commit from copier-ts7`
- [ ] （作者が確認してから）GitHub に `punyguard` リポジトリを作って push する。Actions の権限設定は Phase 5 で行う

## Phase 1: 拡張機能向けにツールチェーンを変える

- [ ] devDependencies に `esbuild`、`@types/chrome` を、dependencies に `punycode` を追加する
- [ ] `import { toUnicode } from "punycode/"` が strict の型検査を通ることを確かめる（`@types/punycode` を足すか、`src/types/punycode.d.ts` で宣言する。上の「ツールチェーン」を参照）
- [ ] tsconfig を `tsconfig.json`（ブラウザ）と `tsconfig.node.json`（Node）に分け、`typecheck` で両方を検査する
- [ ] `scripts/build.ts` を作る（`src/background.ts` と `src/blocked.ts` をエントリにし、静的ファイルを `dist/` にコピーする）
- [ ] `package.json` の scripts: `build`、`build:watch` を追加し、Node 用の `dev` を削除する
- [ ] サンプルの `greet.ts`、`greet.test.ts`、`index.ts` を削除し、カバレッジの除外設定を新しい入口に合わせる
- [ ] `.gitignore` に `dist/` を追加する
- [ ] テンプレートから変えた点を README の「テンプレートとの差分」に書く（`copier update` で衝突したときのため）

## Phase 2: core（TDD）

各モジュールでテストを先に書き、失敗を確認してから実装する。

- [ ] `block-rule.ts`: `buildBlockRule(warningPageUrl)` が DNR の `Rule` を返す
  - [ ] 正規表現の一致のテスト: `xn--` で始まるホスト、サブドメインだけが IDN、TLD だけが IDN（`example.xn--q9jyb4c`）、ポート付き、userinfo 付きでホストが IDN（`https://user@xn--80a6aa68c8d.com/`）
  - [ ] 正規表現の不一致のテスト: ASCII ホスト、パスやクエリに `xn--` を含む、`axn--b.com` のようにラベルの途中に `xn--` がある、IP アドレス、`localhost`
  - [ ] 既知の誤検知を仕様として固定するテスト: `https://xn--a@example.com/` は一致する（「将来」節を参照）
  - [ ] 置換のテスト: `regexSubstitution` を適用した結果が `<警告ページの URL>#<元の URL 全体>` になる
  - RE2 で使えるかどうかは単体テストでは確かめられないので、Phase 4 の E2E で確かめる
- [ ] `protection.ts`: `ensureProtection(deps)` が、ルールの登録とアクセス権の確認を行い、結果に応じてバッジとツールチップを更新する（`deps` に DNR、`permissions.contains`、バッジ、ツールチップ、ログの関数を渡し、テストでは偽物を渡す）
  - [ ] 登録に成功し、アクセス権もあれば、既存のルール ID を削除して新しいルールを追加し、バッジを消す
  - [ ] 登録に失敗したら、エラーをログに出してバッジに `!` を出し、ツールチップに原因を出す。例外は外に投げない
  - [ ] 登録に成功しても、すべてのサイトへのアクセス権がなければ、バッジに `!` を出し、ツールチップに原因を出す
  - [ ] 両方とも満たさないときも、バッジは `!` を1つだけ出し、ツールチップに両方の原因を出す
- [ ] `blocked-url.ts`: `parseBlockedUrl(hash)` が `URL` か `null` を返す
  - [ ] 空、`#` だけ、`http(s)` 以外のスキーム、壊れた URL は `null` になる
- [ ] `host-description.ts`: `describeHost(asciiHost)` が Unicode 表記、Punycode 表記、文字ごとの情報（文字、文字種、コードポイント、ASCII かどうか）を返す
  - [ ] `xn--80a6aa68c8d.com` → `аррӏө.com`、`ө` は Cyrillic の U+04E9
  - [ ] ラテン文字とキリル文字が混在するラベル、日本語のラベル、不正な Punycode（デコードに失敗したら Punycode 表記のまま返す）
- [ ] `_locales/ja/messages.json` と `_locales/en/messages.json` のキーが一致することを確かめるテスト（言語の切り替えそのものは E2E で確かめる）

## Phase 3: 拡張機能本体

- [ ] `manifest.json`: `version: "0.0.1"`（Phase 5 を参照）、`default_locale: "en"`、名前と説明は `__MSG_*__`、`permissions: ["declarativeNetRequest"]`、`host_permissions: ["<all_urls>"]`、`background.service_worker`、`web_accessible_resources`（上の「遮断の仕組み」の形）、`action`（アイコンとバッジのため。ポップアップはなし）
- [ ] `src/background.ts`: `runtime.onInstalled`、`runtime.onStartup`、`permissions.onAdded`、`permissions.onRemoved` で `ensureProtection` を呼び、`chrome.declarativeNetRequest`、`chrome.permissions.contains`、`chrome.action.setBadgeText`、`chrome.action.setTitle` を渡す
- [ ] `src/blocked.html` / `blocked.ts` / `blocked.css`: 上の「警告ページ」の仕様どおりに作る
- [ ] `_locales/ja/messages.json`、`_locales/en/messages.json`
- [ ] `pnpm run build` で `dist/` を作り、パッケージ化せずに読み込んで、`аррӏө.com` で警告ページが出ることを手で確かめる（E2E を書く前の動作確認）
- [ ] 同じ手動確認で、リスク表の未確認事項のうち実機で確かめるもの（`regexSubstitution` での転送、`regexFilter` と Punycode の照合、サイトへのアクセスを制限したときの `permissions.contains`）を確かめる。だめなものがあれば、リスク表の方針に従って依頼者と再合意する

## Phase 4: E2E（Playwright）

- [ ] `@playwright/test` を追加し、`launchPersistentContext` で Chromium を起動する
  - `channel: "chromium"` を指定する。拡張機能を読み込めるのは、この新しいヘッドレスモードか、ヘッドありの起動だけで、既定のヘッドレスシェルでは読み込めない
  - 起動引数に `--disable-extensions-except=<dist の絶対パス>` と `--load-extension=<dist の絶対パス>` の両方を指定する
  - `context.serviceWorkers()`（まだなければ `waitForEvent("serviceworker")`）で service worker を取得し、拡張機能 ID と後続の検証に使う
- [ ] `playwright.config.ts` で `testDir: "e2e"` を指定し、E2E のファイル名は `*.spec.ts` にする。逆に Vitest の設定では `include: ["src/**/*.test.ts"]` を指定する。どちらも既定では `*.test.ts` と `*.spec.ts` の両方を集めるので、指定しないと Playwright が単体テストを、Vitest が E2E を拾って失敗する
- [ ] テスト用の HTTP サーバーを立て、`--host-resolver-rules` で `xn--80a6aa68c8d.com` などをローカルに向ける
- [ ] service worker で `getDynamicRules` を呼び、遮断ルールが1本登録されていることと、`action.getBadgeText` が空であることを確かめる
- [ ] 取り出したルールの `regexFilter` を service worker で `isRegexSupported` に渡し、RE2 で使えることを確かめる
- [ ] 受け入れ基準を1つずつテストにする
  - [ ] 直接の遷移、リンクのクリック、302 リダイレクト、iframe（iframe では操作ボタンがないこと）
  - [ ] `sandbox` 属性付き（`allow-scripts` なし）の iframe: テストサーバーの IDN ホスト用ページへのリクエストが届かず、その中身が表示されないこと。転送された場合は、日英併記の固定の警告文が見え、詳細の欄と操作ボタンが見えないことも確かめる
  - [ ] 警告ページの表示内容（Unicode 表記、Punycode 表記、`ө` の文字種とコードポイント）
  - [ ] 操作ボタン: ASCII ホストのページからリンクで警告ページへ来たとき、「前のページに戻る」が表示され、押すと元のページに戻る / 新しいタブの最初のページとして開いたとき、「前のページに戻る」が表示されない / どちらの場合も「このタブを閉じる」でタブが閉じる
  - [ ] ASCII ホストで日本語のパスを開いても遮断されない
  - [ ] 言語の切り替え: Linux（CI）では、`launchPersistentContext` の `env` に `LANGUAGE=ja`（または `LANGUAGE=en`）を渡して起動し、文言を確かめる。Linux の Chromium は表示言語を `--lang` ではなく環境変数（`LANGUAGE`、`LC_ALL`、`LC_MESSAGES`、`LANG` の順）から決める。macOS の Chromium は OS のバンドル設定から決めるので、macOS ではこのテストを `test.skip` で飛ばし、Phase 6 の手動確認で補う
  - [ ] 同じプロファイル（`userDataDir`）でブラウザを閉じて起動し直しても遮断が続く
  - [ ] フラグメントにスクリプトを仕込んで警告ページを開いても、HTML として解釈されない
- [ ] `pnpm run test:e2e` を追加する。中身は `pnpm run build && playwright test` にして、毎回 `dist/` を作り直してから E2E を実行する（`dist/` は `.gitignore` に入っていて、クリーンなチェックアウトには存在しないため。pnpm は既定では `pre` スクリプトを実行しないので、`pretest:e2e` には頼らない）
- [ ] ローカルで初回だけ `pnpm exec playwright install chromium` を実行する手順を README に書く

## Phase 5: CI、リリース、ドキュメント

- [ ] CI に E2E のジョブを追加する。ジョブは `pnpm install --frozen-lockfile`、Playwright の Chromium のインストール、`pnpm run test:e2e`（ビルドを含む）の順に実行する（Nix で動かすのが難しければ、そのジョブだけ Nix を使わずに `actions/setup-node`（`node-version: 26`）、`pnpm/action-setup`（テンプレートの `devEngines` と同じ pnpm `^12.3`）、`pnpm exec playwright install --with-deps chromium` を使う。Playwright はプロジェクトのローカル依存なので、`playwright` を直接呼ばず、必ず `pnpm exec` を付ける。テンプレートの `devEngines` は Node と pnpm のバージョンが合わないとエラーで止まるので、バージョンを必ず明示する）
- [ ] release-please を導入する
  - [ ] `release-please-config.json`: `release-type: "node"`、`bump-minor-pre-major: true`、`extra-files` に `{ "type": "json", "path": "manifest.json", "jsonpath": "$.version" }`
  - [ ] `.release-please-manifest.json`: `{ ".": "0.0.0" }`。マニフェストの値は「直近にリリースしたバージョン」として扱われるので、まだリリースしていない状態を表す `0.0.0` にする。`package.json` も `0.0.0` にする
  - [ ] `manifest.json` の `version` はリリース前は `0.0.1` にする。Chrome は全要素が 0 のバージョンを無効として扱い、`0.0.0` では拡張機能を読み込めない。`extra-files` は Release のときにこの値を新しいバージョンで上書きするので、release-please の管理値と一致していなくても問題ない
  - [ ] 初回を `0.1.0` に固定するため、`release-please-config.json` のパッケージ設定に `"release-as": "0.1.0"` を入れる（初回のリリース後に外す。Phase 6 を参照）
  - [ ] `.github/workflows/release.yml`: release-please-action を動かし、Release が作られたら `pnpm run build` を実行して `dist/` を `punyguard-vX.Y.Z.zip` にまとめ、`gh release upload` で添付する
    - ビルド環境は CI と同じ Nix の devShell にする（Node と pnpm のバージョンがテンプレートの `devEngines` と一致する）。Nix を使えない場合は、E2E のジョブと同じく Node 26 と pnpm `^12.3` を明示する
    - ワークフローの `permissions` に `contents: write`（Release の作成と zip の添付）、`pull-requests: write`（Release PR の作成と更新）、`issues: write`（ラベルの作成と付与）を書く
    - `gh release upload` には `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` を渡す
    - トークンは `GITHUB_TOKEN` を使う。`GITHUB_TOKEN` が作った PR では他のワークフローが起動しないので、Release PR では CI が走らない。Release PR が変えるのはバージョン番号と CHANGELOG だけなので、個人のリポジトリとしては許容する。CI を走らせたくなったら、fine-grained PAT を secret に登録して `token` に渡す
  - [ ] リポジトリの Settings → Actions → General で、「Workflow permissions」を「Read and write permissions」にし、「Allow GitHub Actions to create and approve pull requests」を有効にする（作者が手で設定する）
- [ ] `LICENSE`（MIT）
- [ ] `README.md`（日本語と英語）
  - [ ] 何をする拡張機能か、記事の例
  - [ ] 正規の日本語ドメインも止まること（ADR-0001）
  - [ ] `<all_urls>` を要求する理由と、content script も外部通信もないこと（ADR-0002）
  - [ ] サイトへのアクセスは「すべてのサイト」のままにすること。制限すると遮断が効かなくなり、バッジに `!` が出ること
  - [ ] バッジの `!` の意味と、ツールチップで原因を確かめる方法
  - [ ] Release の zip から入れる手順と、ソースからビルドする手順

## Phase 6: 仕上げの検証

- [ ] `pnpm run check`（型チェック、lint、format、カバレッジ 80% 以上）と `pnpm run test:e2e`
- [ ] 実際の Chrome で受け入れ基準を手で一通り確かめる。E2E で確かめられない次の3点は特に手で確かめる
  - [ ] 外部アプリから開いたリンク（`open -a "Google Chrome" "https://аррӏө.com/"`）
  - [ ] macOS で Chrome の表示言語を日本語と英語に切り替えたときの文言
  - [ ] 拡張機能画面でサイトへのアクセスを「クリック時」に変えるとバッジに `!` が出て、「すべてのサイト」に戻すと消えること
- [ ] code-reviewer と security-reviewer のエージェントでレビューし、CRITICAL と HIGH を解消する
- [ ] Release PR をマージし、v0.1.0 の Release と zip ができ、`package.json` と `manifest.json` が `0.1.0` に上がっていることを確かめる
- [ ] `release-please-config.json` から `"release-as": "0.1.0"` を外す（残すと、次の Release PR も 0.1.0 を提案し続ける）

## リスクと未確認事項

代案に切り替えると受け入れ基準を弱めたり権限を増やしたりする場合は、その時点で実装を止め、依頼者と再合意してから進める。再合意の結果は受け入れ基準とこの表に反映する。受け入れ基準を変えずに済む代案は、合意なしで切り替えてよい。

| 項目                                                        | 内容                                                                                                                                                                        | 確認方法と代案                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regexSubstitution` で `chrome-extension://` へ転送できるか | 公式ドキュメントに明記はない。uBlock Origin Lite が同じ方法を本番で使っている                                                                                               | Phase 3 で手動確認する。だめなら実装を止めて依頼者と再合意する。候補は2つ。(1) `extensionPath` で転送し、元の URL は `webNavigation.onBeforeNavigate` でタブごとに記録して警告ページに渡す（受け入れ基準は保てるが、`webNavigation` 権限が増える）。(2) `extensionPath` で転送し、警告ページには固定の警告文だけを出す（権限は増えないが、表示内容の受け入れ基準を弱める）                                       |
| `regexFilter` は Punycode 化された URL と照合されるか       | `urlFilter` については明記されている。`regexFilter` は推測                                                                                                                  | Phase 3 の手動確認と E2E で確かめる。照合されなければ実装を止めて依頼者と再合意する（Unicode のまま照合される場合に備えて、正規表現を非 ASCII のホストにも一致させる案などを検討する）                                                                                                                                                                                                                           |
| RE2 で使えない正規表現を書いてしまう                        | 単体テスト（V8）では検出できない。登録に失敗しても見た目には何も起きない                                                                                                    | E2E の `isRegexSupported` で検出する。すり抜けたらバッジの `!` で利用者が気づく                                                                                                                                                                                                                                                                                                                                  |
| Nix 上で Playwright が動くか                                | nixpkgs のブラウザと npm の Playwright のバージョンを揃える必要がある                                                                                                       | CI の E2E ジョブだけ Nix を使わない                                                                                                                                                                                                                                                                                                                                                                              |
| 拡張機能が入っていることを探られる                          | `blocked.html` を公開しているので、ウェブページから存在を確かめられる                                                                                                       | 個人用ツールなので許容する。README に書く                                                                                                                                                                                                                                                                                                                                                                        |
| 言語切り替えの E2E                                          | Chromium は `--lang` を表示言語に使わない。Linux は環境変数、macOS は OS のバンドル設定から決める                                                                           | Linux（CI）では `LANGUAGE` を渡して自動テストする。macOS ではテストを飛ばして手動で確かめる                                                                                                                                                                                                                                                                                                                      |
| 302 リダイレクト後の「前のページに戻る」                    | リダイレクト元のページに戻るのか、さらにその前のページに戻るのか                                                                                                            | E2E で挙動を確かめ、README に書く。どちらでも受け入れ基準は満たす                                                                                                                                                                                                                                                                                                                                                |
| sandbox 付き iframe でも転送されるか                        | sandbox 付き iframe は origin が opaque になる。それでも DNR の転送と `web_accessible_resources` の `<all_urls>` が効くかは未確認                                           | 受け入れ基準は「中身が表示されない」なので、どちらの挙動でも満たす。転送されるかどうかは Phase 4 の E2E で記録し、README に書く                                                                                                                                                                                                                                                                                  |
| アクセス権の制限を `permissions.contains` で検出できるか    | 利用者がサイトへのアクセスを制限したとき、`permissions.contains({ origins: ["<all_urls>"] })` が `false` を返し、`permissions.onRemoved` が発火するはずだが、実機では未確認 | Phase 3 の手動確認で早めに確かめる。検出できなければ、まず `permissions.getAll()` の `origins` に `<all_urls>` が含まれるかで判定し直す（受け入れ基準も権限も変わらないので、合意なしで切り替えてよい）。それでも検出できなければ実装を止めて依頼者と再合意する。そのときの候補は、バッジによる検出をあきらめ、README に「すべてのサイト」のままにする必要があることを目立つ形で書くこと（受け入れ基準を弱める） |
| iframe で表示される警告ページの見た目                       | 小さい iframe では内容がはみ出す                                                                                                                                            | 内容は省略せず、ページ全体と同じものを表示する。CSS で幅に合わせて折り返し、はみ出した分は iframe の中でスクロールさせる                                                                                                                                                                                                                                                                                         |

## 将来（v1 には入れない）

- 許可リスト（オプション画面から追加と削除をする）
- 文字種で判定するモード（例: 漢字とかなだけのラベルは通す）
- ページ内の IDN リンクに印を付ける content script
- userinfo による誤検知をなくす
  - 現状: 正規表現 `^https?://(?:[^/?#]*[.@])?xn--` は userinfo（`@` より前）の中の `xn--` にも一致する。そのため `https://xn--a@example.com/` は、ホストが ASCII なのに遮断される
  - v1 で直さない理由: userinfo 付きの URL をクリックする場面はほとんどない。安全側に倒れる誤検知でもある。受け入れ基準の「ASCII ホストへの遷移には影響しない」でも、この誤検知は例外として明記している
  - 直すときの考慮点: 最後の `@` より後ろだけをホストとして見る正規表現にする。userinfo には `@` をエスケープせずに含む URL もあるので、パーサーがどの `@` を区切りとして扱うかを確かめる。RE2 の制約（後読みなし）の中で書く。Phase 2 の「既知の誤検知」テストを、一致しないことを確かめるテストに書き換える

## レビュー

（完了後に記入）
