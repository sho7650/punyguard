# Service Workerが応答する遷移はcontent scriptで、リダイレクトされた遷移はwebNavigationで警告ページへ移す

DNRはService Workerが応答する遷移に効かない。そのため、ユーザー情報付きURLは、攻撃者のサイトを一度開かせてService Workerを登録させるだけで、遮断をすり抜けられた。そこで、すべてのページとそのiframeに、`document_start`で動くcontent scriptを置く。このcontent scriptは`document.URL`を判定し、遮断理由に当たれば`location.replace`で警告ページへ移す。判定の時点で設定を読みに行くと、ページのスクリプトが先に動く。そのため、拡張機能のservice workerが設定に合わせてcontent scriptを`scripting.registerContentScripts`で登録し直し、content scriptは登録の時点で設定を知っているようにする。ADR-0002の「content scriptを置かない」は、このADRで置き換える。外部と通信しないことと、ページの中身を読まないことは保つ。

Chromium 156で、Service Workerを登録したサイトを、候補ごとに同じ条件で開いて比べた（2026-10-19。攻撃者のSWは中継型と自作型、拡張機能のservice workerは動作中と停止中、各20回）。content scriptだけが、すべての条件で攻撃者のページのスクリプトを動かさなかった。その後、CDPのトレースで描画イベントを数え、content scriptが移す遷移では攻撃者のページが描画されないことを確かめた（各10回。陽性対照では毎回捉えた）。タブの履歴に残るのも、パスワードを伏せた警告ページだけだった。

Service Workerは、遷移にリダイレクトで応答することもできる。この場合、content scriptが見る`document.URL`はリダイレクト先になり、元のURLを知る手段はない（2026-10-19に測定。`redirectCount`・`referrer`・`navigation.activation`のどれにも元のURLは出ない）。リダイレクト先が普通のURLなら、content scriptだけでは毎回すり抜けた。そこで、拡張機能のservice workerが`webNavigation.onBeforeNavigate`で遮断理由に当たる遷移の開始を覚え、その遷移が遮断理由に当たらないURLで確定したと`onCommitted`で分かった時点で、`scripting.executeScript`でそのフレームに`location.replace`させ、警告ページへ移す。ページ全体の遷移とiframeで同じ仕組みを使う。最後は毎回警告ページになり、タブの履歴にも警告ページしか残らなかった。ただし、警告ページに置き換わる前に、リダイレクト先のページのスクリプトが毎回動いた。そのため、リダイレクトの場合は「最後に必ず警告ページに置き換える」ことだけを約束し、置き換わる前に表示・実行されうることは限界とする。

## Considered Options

- **`webNavigation.onBeforeNavigate`で見つけて`tabs.update`で移す（リダイレクトしない応答に対して）**: content scriptを置かずに済む。しかし、拡張機能のservice workerが止まっていると40回中40回負け、攻撃者のページのスクリプトが3〜8ミリ秒先に動いた。拡張機能のservice workerは、使われないとすぐに止まる。リダイレクトの場合は、`webNavigation`で元のURLを知るが、移すのは`tabs.update`ではなく`location.replace`で行う（次の項）。
- **`browsingData`でそのオリジンのService Workerを消す**: 消した後の遷移は、既存のDNRルールで確実に遮断される。しかし1回目は防げない。中継中に消すと、タブは警告ページではなく白紙のまま止まった。content scriptと組み合わせても、同じことが起きた。
- **content scriptが判定の時点で設定を読む**: manifestに書くだけで済む。しかし`chrome.storage`は非同期なので、ページ全体の遷移で45回中45回、ページのスクリプトが先に動いた。
- **リダイレクトに対して、`onBeforeNavigate`の時点で`tabs.update`を呼ぶ**: 拡張機能のservice workerが動作中なら、ページ全体の遷移ではページのスクリプトは一度も動かなかった。しかし停止中は、遅れて届いた`tabs.update`が新しい履歴の項目を作り、10回中10回、平文のパスワード付きの攻撃者のURLや、リダイレクト先の攻撃者のページが「戻る」に残った。DNRやcontent scriptが移した遷移でも動き、警告ページが2つ並んだ。
- **設定を無視して、3つの遮断理由すべてで止める**: 仕組みは単純になる。しかし、利用者が無効にした遮断が、Service Workerが応答する遷移でだけ働くことになり、設定の意味と食い違う。

## Consequences

- `scripting`権限と`webNavigation`権限を要求する。`<all_urls>`があるので、インストール時の警告文は増えない（`management.getPermissionWarningsByManifest`で確認済み）。
- READMEの「content scriptを持たない」を改め、content scriptがすることを書く。URLを見て警告ページへ移すだけで、ページの中身は読まず、外部と通信しない。
- Service Worker自身は、遷移に応答する時点で動く。これは防げない限界としてREADMEに書く。
- Service Workerがリダイレクトで応答した場合は、警告ページに置き換わる前に、リダイレクト先のページが表示され、動きうる。これも限界としてREADMEに書く。
- Service WorkerがSVGやXMLの文書で応答した場合は、警告ページに移る前に、その文書が描画された（2026-10-20に測定。測った組み合わせのすべてで5回中5回）。スクリプトは動かず、最後は警告ページになった。HTML・PDF・テキストの応答では描画されなかった。これも限界としてREADMEに書く。
- 遷移の開始は、メモリではなく`chrome.storage.session`に、パスワードを伏せて覚える。攻撃者のService Workerがリダイレクトを30秒より長く遅らせると、その間に拡張機能のservice workerが止まり、メモリに置いた開始は消えた（2026-10-21に測定。35秒と60秒の遅れで毎回すり抜けた）。`chrome.storage.session`に置くと、35秒・60秒の遅れと、拡張機能のservice workerを途中で止めた場合のいずれでも、毎回警告ページになった。
- 開始の記録は、そのフレームで次の遷移が始まるか、タブが閉じるまで残す。遷移の失敗や確定では消さない。前の遷移の確定が次の遷移の開始より後に届き、リダイレクトの確定を見逃すことがあったため（2026-10-20に測定。41回中2回）。リダイレクトを経て確定したとき（`transitionQualifiers`に`server_redirect`があるとき）だけ、記録を使う。
- 開始の記録には、容量や件数の上限を設けない。記録は溜まりうるので、攻撃者のページが`chrome.storage.session`の容量を埋めると、その後のService Workerのリダイレクトは警告ページへ移らなくなる（2026-10-23に測定）。この弱点は受け入れた（[P7](../decisions.md#p7-filling-storagesession-to-get-past-the-redirect-check-is-accepted)）。
- 移す先はDNRルールと同じ`blocked.html#<元のURL>`とし、パスワードは移す前に伏せる。Service Workerが応答したページはcontent scriptが動く前に確定するが、`location.replace`が履歴の項目を置き換えるので、元のURLはタブの履歴に残らなかった。
- 攻撃者のService Workerがiframeに効くのは、同じトップレベルのサイトの下で登録された場合だけである（ストレージのパーティション分割）。Playwrightは既定で分割を無効にするので、E2Eでは有効にして確かめる。
- 設定を変えると、拡張機能のservice workerは遮断ルールを更新してからcontent scriptの登録を更新する。その間のごく短い間は、content scriptが前の設定で判定する。遮断ルールの更新が非同期なのと同じ性質で、「次の遷移から効かせる」の範囲とする。E2Eは、両方が新しい設定になるまで待ってから遷移する。
- `<object>`と`<embed>`の中の遷移には、Service Workerは応答しなかった。この2つは、引き続きDNRだけで遮断する。
- ユーザー情報付きURLへの遷移をService Workerが中継すると、ブラウザ自身が遷移を失敗させ、エラーページになる（PunyGuardの有無によらない）。エラーページにはcontent scriptも`executeScript`も届かない。`tabs.update`で移しても平文のパスワード付きの項目が「戻る」に残ったので、何もしない。この項目が残ることは限界とする。
- 動的に登録したcontent scriptは、ブラウザの再起動では残るが、拡張機能の更新と再読み込みでは消える（2026-10-20に測定）。`onInstalled`で登録し直すまでの70〜83ミリ秒は、Service Workerが応答する遷移を遮断できない。manifestに書いたcontent scriptなら更新の直後から効くが、設定を渡せないので採らない。この短い間は限界とする。
