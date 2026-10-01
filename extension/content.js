(() => {
  const sentMessages = new Map();
  const sentFiles = new Set();

  let timer = null;
  let lastUrl = location.href;

  const FILE_CHUNK_BYTES =
    512 * 1024;

  function conversationId() {
    const match =
      location.pathname.match(
        /\/c\/([^/?#]+)/
      );

    if (match) {
      return match[1];
    }

    return (
      "chat-" +
      location.pathname
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        )
    );
  }

  function getTurnNodes() {
    return [
      ...document
        .querySelectorAll(
          "[data-turn-key]"
        )
    ];
  }

  function detectRoleAndText(node) {
    let text =
      (
        node.innerText ||
        node.textContent ||
        ""
      )
        .replace(/\u00a0/g, " ")
        .trim();

    if (!text) {
      return null;
    }

    const userPrefixes = [
      /^Você disse:\s*/i,
      /^Voce disse:\s*/i,
      /^You said:\s*/i
    ];

    const assistantPrefixes = [
      /^ChatGPT disse:\s*/i,
      /^ChatGPT said:\s*/i
    ];

    for (const re of userPrefixes) {
      if (re.test(text)) {
        return {
          role: "user",
          text:
            text
              .replace(re, "")
              .trim()
        };
      }
    }

    for (
      const re
      of assistantPrefixes
    ) {
      if (re.test(text)) {
        return {
          role: "assistant",
          text:
            text
              .replace(re, "")
              .trim()
        };
      }
    }

    if (
      node.querySelector(
        ".MarkdownRoot"
      ) ||
      node.querySelector(
        "[data-markdown]"
      )
    ) {
      return {
        role: "assistant",
        text
      };
    }

    return null;
  }

  function messageId(
    node,
    index
  ) {
    return (
      node.getAttribute(
        "data-turn-key"
      ) ||
      node.getAttribute(
        "data-message-id"
      ) ||
      node.id ||
      `turn-${String(index).padStart(6, "0")}`
    );
  }

  function sendRuntime(message) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        message,
        response => {
          if (
            chrome.runtime.lastError
          ) {
            resolve({
              ok: false,
              error:
                chrome.runtime
                  .lastError
                  .message
            });

            return;
          }

          resolve(
            response ?? {
              ok: false
            }
          );
        }
      );
    });
  }

  async function collectMessages() {
    const conv =
      conversationId();

    const nodes =
      getTurnNodes();

    const batch = [];

    nodes.forEach(
      (node, index) => {
        const parsed =
          detectRoleAndText(node);

        if (
          !parsed ||
          !parsed.text
        ) {
          return;
        }

        const id =
          messageId(
            node,
            index
          );

        const key =
          `${conv}::${id}`;

        const fingerprint =
          `${parsed.role}\n${parsed.text}`;

        if (
          sentMessages.get(key) ===
          fingerprint
        ) {
          return;
        }

        sentMessages.set(
          key,
          fingerprint
        );

        batch.push({
          conversation_id:
            conv,

          message_id:
            id,

          role:
            parsed.role,

          text:
            parsed.text,

          url:
            location.href
        });
      }
    );

    if (!batch.length) {
      return;
    }

    const response =
      await sendRuntime({
        type:
          "TERRA_CAPTURE_BATCH",

        messages:
          batch
      });

    if (!response?.ok) {
      console.warn(
        "[Terra Dourada] falha na captura do chat:",
        response
      );

      return;
    }

    console.log(
      `[Terra Dourada] ${batch.length} mensagem(ns) capturada(s).`,
      response.data
    );
  }

  function fnv1a(text) {
    let hash =
      0x811c9dc5;

    for (
      let i = 0;
      i < text.length;
      i++
    ) {
      hash ^=
        text.charCodeAt(i);

      hash =
        Math.imul(
          hash,
          0x01000193
        );
    }

    return (
      hash >>> 0
    ).toString(16);
  }

  function fileId(file) {
    return fnv1a(
      [
        file.name,
        file.size,
        file.lastModified,
        file.type
      ].join("|")
    );
  }

  function bytesToBase64(
    bytes
  ) {
    let binary = "";

    const step = 0x8000;

    for (
      let i = 0;
      i < bytes.length;
      i += step
    ) {
      binary +=
        String.fromCharCode(
          ...bytes.subarray(
            i,
            Math.min(
              i + step,
              bytes.length
            )
          )
        );
    }

    return btoa(binary);
  }

  async function uploadFile(file) {
    const conv =
      conversationId();

    const id =
      fileId(file);

    const dedupeKey =
      `${conv}::${id}`;

    if (
      sentFiles.has(dedupeKey)
    ) {
      return;
    }

    sentFiles.add(dedupeKey);

    const started =
      await sendRuntime({
        type:
          "TERRA_FILE_START",

        meta: {
          conversation_id:
            conv,

          file_id:
            id,

          filename:
            file.name,

          mime:
            file.type,

          size:
            file.size,

          last_modified:
            file.lastModified,

          url:
            location.href
        }
      });

    if (
      !started?.ok ||
      !started.data?.upload_id
    ) {
      sentFiles.delete(
        dedupeKey
      );

      console.warn(
        "[Terra Dourada] não iniciou arquivo:",
        file.name,
        started
      );

      return;
    }

    const uploadId =
      started.data.upload_id;

    try {
      for (
        let offset = 0;
        offset < file.size;
        offset += FILE_CHUNK_BYTES
      ) {
        const blob =
          file.slice(
            offset,
            Math.min(
              offset +
                FILE_CHUNK_BYTES,
              file.size
            )
          );

        const buffer =
          await blob.arrayBuffer();

        const base64 =
          bytesToBase64(
            new Uint8Array(buffer)
          );

        const response =
          await sendRuntime({
            type:
              "TERRA_FILE_CHUNK",

            upload_id:
              uploadId,

            base64
          });

        if (!response?.ok) {
          throw new Error(
            response?.error ||
            JSON.stringify(
              response
            )
          );
        }
      }

      const ended =
        await sendRuntime({
          type:
            "TERRA_FILE_END",

          upload_id:
            uploadId
        });

      if (!ended?.ok) {
        throw new Error(
          ended?.error ||
          JSON.stringify(
            ended
          )
        );
      }

      console.log(
        "[Terra Dourada] arquivo salvo:",
        file.name,
        ended.data
      );
    } catch (error) {
      sentFiles.delete(
        dedupeKey
      );

      console.warn(
        "[Terra Dourada] falha no arquivo:",
        file.name,
        error
      );
    }
  }

  async function captureFiles(
    fileList
  ) {
    const list =
      [...(fileList || [])];

    for (const file of list) {
      if (
        file instanceof File
      ) {
        await uploadFile(file);
      }
    }
  }

  function schedule() {
    clearTimeout(timer);

    timer =
      setTimeout(
        collectMessages,
        1600
      );
  }

  const observer =
    new MutationObserver(
      schedule
    );

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
      characterData: true
    }
  );

  // Arquivos escolhidos no picker.
  document.addEventListener(
    "change",
    event => {
      const target =
        event.target;

      if (
        target instanceof
          HTMLInputElement &&
        target.type === "file" &&
        target.files?.length
      ) {
        captureFiles(
          target.files
        );
      }
    },
    true
  );

  // Arquivos arrastados para o chat.
  document.addEventListener(
    "drop",
    event => {
      if (
        event.dataTransfer
          ?.files
          ?.length
      ) {
        captureFiles(
          event.dataTransfer.files
        );
      }
    },
    true
  );

  setTimeout(
    collectMessages,
    1200
  );

  setInterval(() => {
    if (
      location.href !==
      lastUrl
    ) {
      lastUrl =
        location.href;

      sentMessages.clear();
      sentFiles.clear();

      schedule();
    }
  }, 1000);

  console.log(
    "[Terra Dourada] v4 ativo: chat + arquivos."
  );
})();
