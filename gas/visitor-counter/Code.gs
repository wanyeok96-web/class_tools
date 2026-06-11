/**
 * Class Tools — 방문자 카운터 (Google Apps Script)
 *
 * 배포: 웹 앱 · 실행: doGet · 액세스: 모든 사용자
 * URL 예: .../exec?action=visit
 *
 * ScriptProperties 키: lastDate(yyyy-MM-dd, Asia/Seoul), today, total
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "";
  var callback = (e && e.parameter && e.parameter.callback) || "";

  var payload;
  if (action === "visit") {
    payload = recordVisit_();
  } else {
    payload = {
      success: false,
      message: "지원하지 않는 요청입니다.",
    };
  }

  if (callback) {
    return ContentService.createTextOutput(
      callback + "(" + JSON.stringify(payload) + ")"
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return jsonResponse_(payload);
}

function recordVisit_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var dateStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    var lastDate = props.getProperty("lastDate") || "";
    var today = parseInt(props.getProperty("today") || "0", 10);
    var total = parseInt(props.getProperty("total") || "0", 10);

    if (isNaN(today)) today = 0;
    if (isNaN(total)) total = 0;

    if (lastDate !== dateStr) {
      today = 0;
    }

    today += 1;
    total += 1;

    props.setProperties({
      lastDate: dateStr,
      today: String(today),
      total: String(total),
    });

    return {
      success: true,
      today: today,
      total: total,
    };
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
