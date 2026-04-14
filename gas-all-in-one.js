// ============================================================
// Google Apps Script - 売上計画ダッシュボード All-in-One
// ============================================================
// このスクリプト1つで以下2つの機能を担当します:
//
// 【機能A】Drive 自動バックアップ受信
//   ダッシュボードから POST で送られてきたデータを
//   Google Drive の「売上計画バックアップ」フォルダに保存。
//   30日以上前のバックアップは自動削除。
//
// 【機能B】LINE 朝7時タスク通知
//   毎朝7時に Drive の最新バックアップを読み、
//   今日期日の未完了タスクを LINE に broadcast 送信。
//
// ------------------------------------------------------------
// セットアップ手順:
//
// 1. https://script.google.com で新しいプロジェクトを作成
// 2. 最初からある function myFunction() {} を全部消して
//    このコード全文を貼り付け
// 3. 保存 (Ctrl+S)
//
// --- 機能A のデプロイ (Drive バックアップ) ---
// 4. 右上「デプロイ」→「新しいデプロイ」
// 5. 種類: ウェブアプリ
// 6. 設定:
//    - 説明: 任意
//    - 次のユーザーとして実行: 自分
//    - アクセスできるユーザー: 全員
// 7. 「デプロイ」をクリック、権限を承認
// 8. 発行された「ウェブアプリURL」をコピー
// 9. ダッシュボードの「⚙ Drive設定」を開いて URL を貼り付け
//
// --- 機能B の設定 (LINE 通知) ---
// 10. 左の歯車 (プロジェクトの設定) → 下の方の「スクリプトプロパティ」
// 11. 「スクリプト プロパティを追加」
//     - プロパティ: LINE_TOKEN
//     - 値: LINE Developers で発行したチャネルアクセストークン(長期)
//     - 保存
// 12. エディタに戻り、関数名を「testTokenOnly」に選び「▶実行」
//     → LINE にテストメッセージが届けばOK
// 13. 関数名を「testSendNotification」に変えて「▶実行」
//     → 今日のタスク通知が届けばOK
//     (ダッシュボードを1度開いて Drive バックアップさせてから実行)
// 14. 左の時計アイコン (トリガー) → 「+ トリガーを追加」
//     - 関数: sendDailyTaskNotification
//     - デプロイ: Head
//     - イベントのソース: 時間主導型
//     - タイプ: 日付ベースのタイマー
//     - 時刻: 午前7時〜8時
//     - 保存
// ============================================================

// ===== 設定 =====
const FOLDER_NAME        = '売上計画バックアップ';
const MAX_BACKUP_DAYS    = 30;
const LINE_API_BROADCAST = 'https://api.line.me/v2/bot/message/broadcast';
const TZ                 = 'Asia/Tokyo';


// ==============================================================
// 【機能A】Drive 自動バックアップ受信 (POST エンドポイント)
// ==============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const folder = getOrCreateFolder(FOLDER_NAME);

    const now = new Date();
    const dateStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd_HHmmss');
    const fileName = 'バックアップ_' + dateStr + '.json';

    const content = JSON.stringify(data, null, 2);
    folder.createFile(fileName, content, MimeType.PLAIN_TEXT);

    cleanOldBackups(folder);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        message: 'バックアップを保存しました: ' + fileName,
        timestamp: now.toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: 'エラー: ' + error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: '売上計画バックアップAPIは正常に動作しています'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

function cleanOldBackups(folder) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_BACKUP_DAYS);
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated() < cutoff) {
      file.setTrashed(true);
    }
  }
}


// ==============================================================
// 【機能B】LINE 朝のタスク通知
// ==============================================================
// 時間トリガーから呼ばれるメイン関数
// 金曜日の朝は「今週の振り返りが未入力」の場合はリマインダーを追記
function sendDailyTaskNotification() {
  const store = loadLatestStore();
  if (!store) {
    sendLineMessage(
      '⚠️ タスク通知\n\n' +
      'Google Drive の「' + FOLDER_NAME + '」フォルダにバックアップが見つかりませんでした。\n' +
      '一度ダッシュボードを開いて「☁ Drive」ボタンから手動バックアップしてください。'
    );
    return;
  }
  const todayTasks = getTasksDueToday(store);
  let message = buildLineMessage(todayTasks);

  // 金曜日なら今週の振り返りが未入力かチェック
  const now = new Date();
  if (now.getDay() === 5) { // Friday
    const reminderNeeded = !isThisWeekReviewed(store);
    if (reminderNeeded) {
      message = '📝 今週の振り返りがまだ未入力です。金曜の終わりまでに「今週の振り返り」を記入しましょう！\n\n' + message;
    }
  }

  sendLineMessage(message);
}

// 現在の週（月〜日）の振り返りが store に存在するか
function isThisWeekReviewed(store) {
  if (!store || !Array.isArray(store.weeklyReviews)) return false;
  const now = new Date();
  // 日曜までの最終日をYYYY-MM-DDで
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToSun = (day === 0 ? 0 : 7 - day);
  const sunday = new Date(now);
  sunday.setDate(sunday.getDate() + diffToSun);
  const weekEnd = Utilities.formatDate(sunday, TZ, 'yyyy-MM-dd');
  return store.weeklyReviews.some(function(r) { return r && r.weekEnd === weekEnd; });
}

// 手動実行用: 今日のタスク通知をテスト送信
function testSendNotification() {
  sendDailyTaskNotification();
}

// 手動実行用: LINE トークンが正しくセットされているか確認
function testTokenOnly() {
  sendLineMessage('✅ GAS から LINE への送信テスト成功');
}

// 最新バックアップ JSON を Drive から読み込み
function loadLatestStore() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!folders.hasNext()) {
    Logger.log('Folder not found: ' + FOLDER_NAME);
    return null;
  }
  const folder = folders.next();

  // 修正日時が最新のファイルを取得
  const iter = folder.getFiles();
  let latest = null;
  while (iter.hasNext()) {
    const f = iter.next();
    if (!latest || f.getLastUpdated().getTime() > latest.getLastUpdated().getTime()) {
      latest = f;
    }
  }
  if (!latest) {
    Logger.log('No backup files found');
    return null;
  }
  Logger.log('Loading: ' + latest.getName() + ' (' + latest.getLastUpdated() + ')');

  try {
    const content = latest.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, '');
    const data = JSON.parse(content);
    // ダッシュボードのバックアップは { version, store, ... } 形式
    return data.store || data;
  } catch (e) {
    Logger.log('JSON parse error: ' + e);
    return null;
  }
}

// 今日期日かつ未完了のタスクを抽出 (期日超過も含む)
function getTasksDueToday(store) {
  const tasks = (store && store.tasks) || [];
  const today = todayYMD();

  let completedNames = [];
  try {
    const statuses = (store.taskSettings && store.taskSettings.statuses) || [];
    completedNames = statuses
      .filter(function(s){ return s && s.completed; })
      .map(function(s){ return s.name; });
  } catch (e) {}
  if (completedNames.length === 0) completedNames = ['完了'];

  return tasks.filter(function(t) {
    if (!t.dueDate) return false;
    if (completedNames.indexOf(t.status) >= 0) return false;
    return t.dueDate <= today;
  }).sort(function(a, b) {
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  });
}

// LINE 送信用メッセージ構築
function buildLineMessage(tasks) {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
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

// LINE Messaging API へ broadcast 送信 (Bot の友だち全員へ)
function sendLineMessage(text) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  if (!token) {
    throw new Error('スクリプトプロパティ LINE_TOKEN が設定されていません。' +
                    'プロジェクトの設定 → スクリプトプロパティ から追加してください。');
  }
  if (text.length > 4900) text = text.substring(0, 4900) + '\n...(省略)';

  const payload = { messages: [{ type: 'text', text: text }] };
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

function todayYMD() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
