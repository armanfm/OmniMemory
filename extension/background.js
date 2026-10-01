const BASE = "http://127.0.0.1:8787";
const CAPTURE_KEY = "0195f5c990a1ef54ee9f3976684f44a49e2eadf32f2f1be3";

async function post(path, body) {
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-terra-key": CAPTURE_KEY
    },
    body: JSON.stringify(body)
  });

  const data = await response
    .json()
    .catch(() => ({}));

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type === "TERRA_CAPTURE_BATCH") {
      post("/capture/batch", {
        messages: message.messages ?? []
      })
        .then(sendResponse)
        .catch(error => {
          sendResponse({
            ok: false,
            error: String(error)
          });
        });

      return true;
    }

    if (message?.type === "TERRA_FILE_START") {
      post("/capture/file/start", message.meta ?? {})
        .then(sendResponse)
        .catch(error => {
          sendResponse({
            ok: false,
            error: String(error)
          });
        });

      return true;
    }

    if (message?.type === "TERRA_FILE_CHUNK") {
      post("/capture/file/chunk", {
        upload_id: message.upload_id,
        base64: message.base64
      })
        .then(sendResponse)
        .catch(error => {
          sendResponse({
            ok: false,
            error: String(error)
          });
        });

      return true;
    }

    if (message?.type === "TERRA_FILE_END") {
      post("/capture/file/end", {
        upload_id: message.upload_id
      })
        .then(sendResponse)
        .catch(error => {
          sendResponse({
            ok: false,
            error: String(error)
          });
        });

      return true;
    }
  }
);
