# Azure AI Gatewayのトークン上限を検証する

[English](README.en.md)

Azure API Managementの`llm-token-limit`を使い、設定した上限と実際のトークン消費量を比較します。対象はDeveloperプランの単一ゲートウェイです。通常応答の事前推定ON／OFFと、ストリーミングを並列数1・4・8で試します。

2026年10月1日に検証しました。800トークンのクォータに対し、実消費は最大1,472トークンでした。超過は672トークン、設定値の84%です。専用リソースグループは削除済みで、請求確定前の公開単価による概算は約77円です。

## 実測結果

Japan EastのAPIM Developer classicを1ユニット使用しました。モデルはRegional Standardの`gpt-4.1-mini`、バージョン`2025-04-14`です。[固定した条件](experiments/protocol.json)と[実行マニフェスト](results/manifests.json)を公開しています。

| 条件 | 並列数 | 実消費の中央値 | 超過の中央値 | 超過の最大値 | 成立した試行 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 通常・事前推定OFF | 1 | 920 | 120 | 120 | 5/5 |
| 通常・事前推定OFF | 4 | 1,472 | 672 | 672 | 5/5 |
| 通常・事前推定OFF | 8 | 1,472 | 672 | 672 | 5/5 |
| 通常・事前推定ON | 1 | 920 | 120 | 120 | 5/5 |
| 通常・事前推定ON | 4 | 1,472 | 672 | 672 | 5/5 |
| 通常・事前推定ON | 8 | 1,472 | 672 | 672 | 5/5 |
| ストリーミング | 1 | 920 | 120 | 672 | 5/5 |
| ストリーミング | 4 | 1,472 | 672 | 672 | 5/5 |
| ストリーミング | 8 | 1,472 | 672 | 672 | 5/5 |

単位はトークンです。超過量は`max(0, 試行内のprovider usage合計 - 800)`で計算します。1試行は、独立したカウンターで拒否まで送信し、送信済み応答と確認用リクエストを回収する一連の実行です。

![試行ごとの超過量](results/quota-overshoot.svg)

主実験45試行、対照18試行、レート制限9試行はすべて成立しました。本実験の795リクエストでは、200が537件、クォータの403が240件、レート制限の429が18件です。成功応答のusage欠落やモデル側エラーはありませんでした。レート制限は1,200トークン／分で別に試し、429の`Retry-After`は46〜48秒でした。

通常応答で記録したトークン数は、全件で入力56、出力128です。今回の条件では事前推定ONとOFFの結果は同じです。これは事前推定が無意味という結論ではありません。逐次実行で4回成功すると残量は64で、次の入力56トークンを受け入れられます。入力だけの事前推定では、その後の出力128トークンまで収まるとは限りません。

ストリーミングもprovider usageは入力56、出力128でした。一方、応答ヘッダーの`x-lab-consumed`は56です。SSEが終わる前に届く値なので、最終消費量として足し合わせてはいけません。逐次ストリーミングの実消費は`[1472, 920, 920, 920, 920]`でした。この1回の差の内部原因は、今回の応答記録だけでは特定していません。

並列数4と8で同じ最大値になった点にも注意してください。負荷をかけ続ける試験ではなく、組ごとに全応答を待つ方式です。並列数に比例する保証や、本番プラン全般の上限値は測っていません。送信開始の組内のずれは最大7ミリ秒でした。[時系列の図](results/quota-timeline.svg)は並列数8の各条件の初回を表示しています。

## クラウドを使わずに再集計する

```powershell
npm ci
npm test
npm run verify:results
```

公開済みの[リクエスト記録](results/requests.jsonl)、[試行集計](results/trials.json)、[全体集計](results/summary.json)だけで検査できます。各試行のトークン合計、超過、成立数、SHA-256を再計算し、不一致ならエラーになる仕組みです。WindowsとLinuxのCIでも同じ検査を実行します。[CSV](results/trials.csv)もあります。

予備実験は5回実行し、[別の記録](results/pilot-attempts.json)に残しました。IP制限で止まった3回と、1,200トークンで確認用リクエストを上限内に送れなかった1回を含みます。800へ調整した最後の予備実験は、23リクエストで5条件とも成立しました。これらの[56リクエスト](results/pilot-requests.jsonl)を本実験には混ぜていません。

## 公開範囲

公開するのは再現用コードと、匿名化した検証結果です。記事本文、生ログ、Azureの識別情報、認証情報は公開対象外とします。

## 費用と削除

APIM Developerには、リクエストがなくても稼働料が発生します。Azure OpenAIの推論料金も必要です。料金と利用枠を確認してから、専用リソースグループに作成してください。検証後は専用リソースだけを削除します。

今回の[削除・費用記録](results/operations.json)では、作成から削除確認まで約4.97時間です。APIMを5時間に切り上げると約51.83円、予備実験を含むモデル推論は約25.08円で、合計約76.91円です。税・契約単価を含む請求額は確認できていません。無料サービスを使った検証ではありません。

```powershell
npm ci
npm run typecheck
npm test
az bicep build --file infra\main.bicep
```

パラメータと生ログは、このリポジトリの外に保存します。GitHub Actionsではクラウドへのデプロイや有料の推論を実行しません。

## 検証プログラム

Node.js 24、PowerShell 7、Azure CLIを使います。`$private`にはリポジトリ外の保存先を、`$subscription`には作成先のサブスクIDを指定してください。`$suffix`には未使用の接尾辞を入れます。

```powershell
.\scripts\prepare-lab.ps1 -SubscriptionId $subscription -PrivateRoot $private -Suffix $suffix
.\scripts\deploy-lab.ps1 -PrivateRoot $private
```

デプロイが成功したら、クライアント設定を非公開の保存先に書き出します。ポリシー更新用のスクリプトは`update-policies.ps1`です。APIM本体は再作成しません。

プロキシ経由では、IP確認サービスとAPIMで送信元IPが異なる場合があります。APIM向けの送信元が分かっていれば、作成時に`-AllowedIp`で指定できます。`lab-ip-filter`による403が出た場合は、APIMのトレースで送信元を確認してください。非公開パラメータの`allowedIp`を直し、ポリシーを更新します。無断でIP制限や認証を外さないでください。

IP制限は既定で有効です。今回の短時間検証に限り、所有者の承認を得て非公開パラメータの`restrictClientIp`を`false`にしました。検証用キーによる認証と、モデル側のマネージドID認証は維持しています。キーなしの呼び出しが401になることも確認済みです。

```powershell
.\scripts\export-client-config.ps1 -PrivateRoot $private
npm run build
node dist\src\run.js $private pilot
```

予備実験は最大32リクエストです。使用量、ストリームの終了、拒否元を確認し、クォータ値を固定してから本実験へ進みます。通常応答の推定ON／OFFとストリーミングを比較し、ストリーミングの推定ON／OFFを別条件にはしません。

初期のBicep既定値は1,200です。今回の本実験を再現するには、非公開の`config\parameters.json`で`quotaTokens.value`を800に設定してください。その後、`update-policies.ps1`と`export-client-config.ps1`を実行します。IP制限を有効にして再検証する場合は、公開側の`experiments\protocol.json`の`restrictClientIp`も`true`に直し、別条件としてコミットしてください。本実験の実行時に、ローカル設定と固定条件の一致を検査します。

本実験はコミット済みで変更のない作業ツリーから実行します。通信の自動リトライはありません。使用量が欠けた場合やモデル側のエラーは記録して停止し、成功した試行に混ぜない設計です。

```powershell
node dist\src\run.js $private control
node dist\src\run.js $private quota
node dist\src\run.js $private rate
node dist\src\report.js $private $controlRunId $quotaRunId $rateRunId
```

対照18試行、主実験45試行、レート制限9試行を実行します。各試行は最大64リクエスト、並列数は最大8です。送信前に予算を予約し、累計4,000リクエスト、推定200万トークン、見込み1万円のいずれかを超える実行を止めます。

生の応答とヘッダーは非公開側に残します。公開する形式はJSONL、CSV、SVGです。集計時に許可した項目だけを`results`へ書き出します。403や429だけではAPIMによる拒否と判定しません。ポリシーの識別子と実行位置を確認できた拒否だけを、バックエンド消費0として扱います。

カウンターキーをクライアントから渡すのは、試行を分けるための検証用設定です。本番の利用者別制限には流用しないでください。本番では認証済みの利用者情報などからキーを決めます。

記録を保存したら、専用グループ名を明示して削除します。

```powershell
.\scripts\remove-lab.ps1 -PrivateRoot $private -ConfirmResourceGroup $dedicatedGroupName
```

## 仕様

対応プラン、推定、ストリーミング、並列実行の仕様は[公式ポリシー資料](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy)を参照してください。期間内クォータによる403と、トークンレート制限による429は分けて記録します。

日本語の推敲・検査に使うのは、[yomiyasu](https://github.com/nanaism/yomiyasu)の固定版`23e16634357f3361cf3ea1cacf2684aa3d9f182f`です。
