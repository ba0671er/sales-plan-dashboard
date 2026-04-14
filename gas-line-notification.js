// ============================================================
// Google Apps Script - 売上計画ダッシュボード 朝のタスク通知
// ============================================================
// 毎朝7時に Drive のバックアップから今日期日の未完了タスクを
// 取り出して LINE へ通知します（LINE Messaging API の broadcast
// エンドポイントを使用）。
//
// セットアップ手順:
// 1. https://script.google.com で新しいプロジェクトを作成
// 2. このコード全文を貼り付け
// 3. 右の歯車 (プロジェクトの設定) → 「スクリプトプロパティ」
//    - プロパティ: LINE_TOKEN
//    - 値: LINE Developers Console で発行した「チャネルアクセス
//          トークン（長期）」
// 4. エディタに戻り、関数一覧から testSendNotification を選んで
//    「実行」→ 権限リクエストを承認 → LINE にテスト通知が届くか
//    確認
// 5. 左メニューの「トリガー」(時計アイコン) → 「トリガーを追加」
//    - 関数: sendDailyTaskNotification
//    - デプロイ: Head
//    - イベントのソース: 時間主導型
//    - 時間ベースのトリガーのタイプ: 日付ベースのタイマー
//    - 時刻: 午前7時〜8時
//    - 保存
// ============================================================

// ===== 設定 (必要に応じて変更可) =====
const DRIVE_FOLDER_NAME   = '売上計画バックアップ'; // gas-backup-script.js と同じ名前
const LINE_API_BROADCAST  = 'https://api.line.me/v2/bot/message/broadcast';
const TZ                  = 'Asia/Tokyo';

// ============================================================
// メイン関数 (時間トリガーから毎朝7時に呼ばれる)
// ============================================================
function sendDailyTaskNotification() {
  const store = loadLatestStore();
  if (!store) {
    sendLineMessage(
      '⚠️ タスク通知\n\n' +
      'Google Drive の「' + DRIVE_FOLDER_NAME + '」フォルダにバックアップが見つかりませんでした。\n' +
      '一度ダッシュボードを開いて「☁ Drive」ボタンから手動バックアップしてください。'
    );
    return;
  }
  const todayTasks = getTasksDueToday(store);
  const message = buildMessage(todayTasks);
  sendLineMessage(message);
}

// 手動実行用: エディタから「実行」してLINEが届くかテスト
function testSendNotification() {
  sendDailyTaskNotification();
}

// 手動実行用: スクリプトプロパティの LINE_TOKEN が正しくセットされているか確認
function testTokenOnly() {
  sendLineMessage('✅ GAS から LINE への送信テスト成功');
}

// ============================================================
// Google Drive から最新バックアップを読み込み
// ============================================================
function loadLatestStore() {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (!folders.hasNext()) {
    Logger.log('Folder not found: ' + DRIVE_FOLDER_NAME);
    return null;
  }
  const folder = folders.next();

  // 修正日時が最新のファイルを取得
  const iterator = folder.getFiles();
  let latest = null;
  while (iterator.hasNext()) {
    const f = iterator.next();
    if (!latest || f.getLastUpdated().getTime() > latest.getLastUpdated().getTime()) {
      latest = f;
    }
  }
  if (!latest) {
    Logger.log('No backup files found');
    return null;
  }
  Logger.log('Loading: ' + latest.getName() + ' (updated ' + latest.getLastUpdated() + ')');

  try {
    const content = latest.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, '');
    const data = JSON.parse(content);
    // ダッシュボードのバックアップは { version, store, ... } の形式
    return data.store || data;
  } catch (e) {
    Logger.log('JSON parse error: ' + e);
    return null;
  }
}

// ============================================================
// 今日期日の未完了タスクを抽出
//   - 期日が今日以前
//   - ステータスが "完了扱い" でない
//   - 期日の昇順に並ぶ
// ============================================================
function getTasksDueToday(store) {
  const tasks = (store && store.tasks) || [];
  const today = todayYMD();

  // taskSettings.statuses から「完了扱い」ステータス名を取得
  let completedNames = [];
  try {
    const statuses = (store.taskSettings && store.taskSettings.statuses) || [];
    completedNames = statuses.filter(function(s){ return s && s.completed; })
                             .map(function(s){ return s.name; });
  } catch (e) {}
  // フォールバック: 設定がなければ「完了」を完了扱いとする
  if (completedNames.length === 0) completedNames = ['完了'];

  return tasks.filter(function(t) {
    if (!t.dueDate) return false;
    if (completedNames.indexOf(t.status) >= 0) return false;
    return t.dueDate <= today; // 期日当日 + 期日超過を含む
  }).sort(function(a, b) {
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  });
}

// ============================================================
// 通知メッセージ構築
// ============================================================
function buildMessage(tasks) {
  const now = new Date();
  const m  = now.getMonth() + 1;
  const d  = now.getDate();
  const dayOfWeek = ['日','月','火','水','木','金','土'][now.getDay()];
  const header = '📋 本日のタスク ' + m + '/' + d + '(' + dayOfWeek + ')';

  if (tasks.length === 0) {
    return header + '\n\n今日が期日のタスクはありません。お疲れさまです！ 🎉';
  }

  const today = todayYMD();
  let overdueCount = 0;
  const lines = tasks.map(function(t) {
    const isOverdue = t.dueDate && t.dueDate < today;
    if (isOverdue) overdueCount++;
    const marker = isOverdue ? '⚠️' : '▶';
    const overdueLabel = isOverdue ? ' (期日超過: ' + t.dueDate + ')' : '';

    const tagParts = [];
    if (t.category) tagParts.push('[' + t.category + ']');
    if (t.client)   tagParts.push(t.client);
    if (t.store)    tagParts.push('/' + t.store);
    const tag = tagParts.join(' ');
    const assignee = t.assignee ? ' @' + t.assignee : '';

    let line = marker + ' ' + (t.content || '(無題)') + overdueLabel;
    if (tag || assignee) line += '\n   ' + tag + assignee;
    return line;
  });

  let summary = tasks.length + '件';
  if (overdueCount > 0) summary += ' (うち超過 ' + overdueCount + '件)';

  return header + ' ' + summary + '\n' +
         '━━━━━━━━━━━━━━\n' +
         lines.join('\n');
}

// ============================================================
// LINE Messaging API へ broadcast 送信
//   - User ID 不要
//   - Bot を友だち追加している全員に届く
// ============================================================
function sendLineMessage(text) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  if (!token) {
    throw new Error('スクリプトプロパティ LINE_TOKEN が設定されていません。' +
                    'プロジェクトの設定 → スクリプトプロパティ から追加してください。');
  }

  // LINE のテキストメッセージは 5000 文字上限。超える場合は切り詰め。
  if (text.length > 4900) {
    text = text.substring(0, 4900) + '\n...(省略)';
  }

  const payload = {
    messages: [{ type: 'text', text: text }]
  };

  const response = UrlFetchApp.fetch(LINE_API_BROADCAST, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  Logger.log('LINE API response: ' + code + ' ' + body);
  if (code !== 200) {
    throw new Error('LINE API エラー ' + code + ': ' + body);
  }
}

// ============================================================
// 日付ユーティリティ (日本時間ベースの YYYY-MM-DD)
// ============================================================
function todayYMD() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
